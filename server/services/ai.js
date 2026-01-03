import * as deepl from 'deepl-node';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { getProfileById, DEFAULT_PROFILES } from './profiles.js';

// Get proper path to .env in project root
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '../../.env') });

// Initialize clients
let genAI = null;
let deeplTranslator = null;

function getGenAI() {
    if (!genAI) {
        genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
    }
    return genAI;
}

function getDeepL() {
    if (!deeplTranslator) {
        const apiKey = process.env.DEEPL_API_KEY || '';
        if (!apiKey) {
            console.warn('DeepL API Key is missing!');
        }
        deeplTranslator = new deepl.Translator(apiKey);
    }
    return deeplTranslator;
}

// Detect language (Korean or English)
function detectLanguage(text) {
    const koreanRegex = /[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/;
    const koreanChars = (text.match(koreanRegex) || []).length;
    const totalChars = text.replace(/\s/g, '').length;

    return koreanChars / totalChars > 0.3 ? 'ko' : 'en';
}

// Direct translation using Gemini (for literal/direct accuracy)
async function translateWithGemini(text, sourceLanguage, targetLanguage) {
    const model = getGenAI().getGenerativeModel({ model: 'gemini-1.5-pro' });
    const sourceName = sourceLanguage === 'ko' ? 'Korean' : 'English';
    const targetName = targetLanguage === 'ko' ? 'Korean' : 'English';

    const prompt = `Translate the following ${sourceName} text to ${targetName}.
Mode: DIRECT / LITERAL.
Translate word-for-word where possible while keeping the sentence grammatical. 
Do not add natural fillers or changing the sentence structure unnecessarily.
Preserve the exact original meaning.

Text: "${text}"

Respond with ONLY a JSON object:
{"translation": "the translated text"}`;

    const result = await model.generateContent(prompt);
    const response = result.response.text();
    try {
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : response);
        return parsed.translation;
    } catch {
        // Fallback: try to clean response
        return response.replace(/```json/g, '').replace(/```/g, '').trim();
    }
}

// Main translation function
export async function translateText(text, profileId = 'natural', customRules = []) {
    const sourceLanguage = detectLanguage(text);
    const targetLanguage = sourceLanguage === 'ko' ? 'en-US' : 'ko';

    // Special Case: Direct Profile -> Use Gemini for Literal Translation
    if (profileId === 'direct') {
        try {
            console.log('Using Gemini for Direct translation...');
            const geminiTranslation = await translateWithGemini(text, sourceLanguage, targetLanguage);

            // Back-Translation using DeepL (for consistent checking)
            const translator = getDeepL();
            const backTarget = sourceLanguage === 'ko' ? 'ko' : 'en-US';
            const backTranslationResult = await translator.translateText(geminiTranslation, null, backTarget);

            // Accuracy Score
            let accuracyScore = null;
            try {
                accuracyScore = await calculateAccuracyScore(text, backTranslationResult.text, sourceLanguage);
            } catch (e) { accuracyScore = { score: 0, explanation: 'Scoring unavailable' }; }

            return {
                original: text,
                sourceLanguage,
                targetLanguage: targetLanguage === 'en-US' ? 'en' : 'ko',
                translation: geminiTranslation,
                translationConfidence: 0.9,
                translationNotes: 'Using Literal/Direct mode (Gemini)',
                reTranslation: backTranslationResult.text,
                reTranslationNotes: '',
                accuracyScore,
                profileUsed: 'Direct (Gemini)'
            };
        } catch (e) {
            console.error('Gemini Direct Translation Failed:', e);
            // Fallback to DeepL if Gemini fails
        }
    }

    // Default: Use DeepL
    const translator = getDeepL();

    // Map profiles to DeepL formality
    // Natural -> Formal (Elders) -> prefer_more
    // Parent Talk -> Polite (Standard) -> default
    let formality = 'default';
    if (profileId === 'natural') {
        formality = 'prefer_more';
    } else if (profileId === 'parent-talk') {
        formality = 'default'; // Usually polite/friendly
    }

    try {
        let translationResult;
        try {
            // Attempt with formality preference
            translationResult = await translator.translateText(text, null, targetLanguage, {
                formality: targetLanguage === 'en-US' ? 'default' : formality
            });
        } catch (e) {
            // Fallback if formality not supported
            translationResult = await translator.translateText(text, null, targetLanguage);
        }

        const translatedText = translationResult.text;

        // Back-Translation using DeepL
        // We want to translate the RESULT back to the SOURCE language to verify accuracy
        // So if source was 'en', we translate back to 'en-US'. If source was 'ko', back to 'ko'.
        const backTarget = sourceLanguage === 'ko' ? 'ko' : 'en-US';
        const backTranslationResult = await translator.translateText(translatedText, null, backTarget);
        const backTranslatedText = backTranslationResult.text;

        // Calculate accuracy score using Gemini
        // We make this non-blocking so main translation succeeds even if Gemini fails (quota/errors)
        let accuracyScore = null;
        try {
            accuracyScore = await calculateAccuracyScore(text, backTranslatedText, sourceLanguage);
        } catch (scoreError) {
            console.warn('Accuracy scoring failed:', scoreError.message);
            accuracyScore = { score: 0, explanation: 'Scoring temporarily unavailable' };
        }

        return {
            original: text,
            sourceLanguage,
            targetLanguage: targetLanguage === 'en-US' ? 'en' : 'ko',
            translation: translatedText,
            translationConfidence: 1.0,
            translationNotes: profileId === 'natural' ? 'Using formal tone (DeepL)' : '',
            reTranslation: backTranslatedText,
            reTranslationNotes: '',
            accuracyScore,
            profileUsed: getProfileById(profileId)?.name || 'DeepL'
        };

    } catch (error) {
        console.error('DeepL Translation Error:', error);
        throw new Error(`DeepL Error: ${error.message}`);
    }
}

// Calculate semantic similarity between original and re-translation using Gemini
async function calculateAccuracyScore(original, reTranslation, language) {
    const model = getGenAI().getGenerativeModel({ model: 'gemini-1.5-pro' });

    const prompt = `Compare these two texts for semantic similarity. Rate from 0-100 how much meaning is preserved.

Original: "${original}"
Back-translation: "${reTranslation}"

Consider:
- Core meaning preserved (most important)
- Nuance and tone preserved
- Cultural context maintained

Respond with ONLY a JSON object:
{"score": 85, "explanation": "brief explanation"}`;

    const result = await model.generateContent(prompt);
    const response = result.response.text();

    try {
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : response);
        return { score: parsed.score, explanation: parsed.explanation };
    } catch {
        return { score: 75, explanation: 'Unable to calculate precise score' };
    }
}

// Get alternative translations for a word/phrase using Gemini
export async function getAlternatives(word, context, sourceLanguage, targetLanguage) {
    const model = getGenAI().getGenerativeModel({ model: 'gemini-1.5-pro' });

    const sourceName = sourceLanguage === 'ko' ? 'Korean' : 'English';
    const targetName = targetLanguage === 'ko' ? 'Korean' : 'English';

    const prompt = `Given this ${targetName} word/phrase: "${word}"
Context: "${context}"
Original language: ${sourceName}

Provide 5 alternative translations that could work in this context.
For each alternative, briefly explain the nuance difference.

Respond with ONLY a JSON array:
[
  {"text": "alternative1", "nuance": "explanation"},
  {"text": "alternative2", "nuance": "explanation"}
]`;

    const result = await model.generateContent(prompt);
    const response = result.response.text();

    try {
        const jsonMatch = response.match(/\[[\s\S]*\]/);
        return JSON.parse(jsonMatch ? jsonMatch[0] : '[]');
    } catch {
        return [{ text: word, nuance: 'Original translation' }];
    }
}

// Generate a different variation using Gemini
export async function generateVariation(originalText, currentTranslation, profileId) {
    const model = getGenAI().getGenerativeModel({ model: 'gemini-1.5-pro' });
    const profile = getProfileById(profileId) || DEFAULT_PROFILES[0];
    const sourceLanguage = detectLanguage(originalText);
    const targetLanguage = sourceLanguage === 'ko' ? 'English' : 'Korean';

    const prompt = `Original text: "${originalText}"
Current translation: "${currentTranslation}"
Target language: ${targetLanguage}
Style: ${profile.description}

Generate a DIFFERENT translation that incorporates:
1. Common ${targetLanguage} idioms, proverbs, or sayings that fit the context
2. Natural expressions that native speakers would actually use
3. Cultural nuances and colloquialisms
4. If translating to Korean: consider 사자성어 (four-character idioms), 속담 (proverbs), or common expressions like 화이팅, 수고하셨습니다, etc.
5. If translating to English: use equivalent English idioms or casual expressions

The variation should feel MORE natural and culturally authentic than a direct translation.

Respond with ONLY a JSON object:
{"translation": "the new translation using idioms/common phrases", "difference": "explain the idiom/phrase used and its cultural meaning"}`;

    const result = await model.generateContent(prompt);
    const response = result.response.text();

    try {
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        return JSON.parse(jsonMatch ? jsonMatch[0] : response);
    } catch {
        return { translation: currentTranslation, difference: 'Could not generate variation' };
    }
}
