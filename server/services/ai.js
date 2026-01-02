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

// Main translation function using DeepL
export async function translateText(text, profileId = 'natural', customRules = []) {
    const translator = getDeepL();
    const sourceLanguage = detectLanguage(text);
    const targetLanguage = sourceLanguage === 'ko' ? 'en-US' : 'ko';

    // Map profiles to DeepL formality
    let formality = 'default';
    if (profileId === 'parent-talk') {
        formality = 'prefer_less'; // Informal
    } else if (profileId === 'direct') {
        formality = 'default';
    }

    try {
        let translationResult;
        try {
            // Attempt with formality preference
            translationResult = await translator.translateText(text, null, targetLanguage, {
                formality: targetLanguage === 'en-US' ? 'default' : formality
            });
        } catch (e) {
            // Fallback if formality not supported for pair
            if (e.message && e.message.includes('formality')) {
                translationResult = await translator.translateText(text, null, targetLanguage);
            } else {
                throw e;
            }
        }

        const translatedText = translationResult.text;

        // Back-Translation using DeepL
        const backTarget = sourceLanguage === 'ko' ? 'en-US' : 'ko';
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
            translationNotes: profileId === 'parent-talk' ? 'Using informal tone (DeepL)' : '',
            reTranslation: backTranslatedText,
            reTranslationNotes: '',
            accuracyScore,
            profileUsed: getProfileById(profileId)?.name || 'Custom (DeepL)'
        };

    } catch (error) {
        console.error('DeepL Translation Error:', error);
        throw new Error(`DeepL Error: ${error.message}`);
    }
}

// Calculate semantic similarity between original and re-translation using Gemini
async function calculateAccuracyScore(original, reTranslation, language) {
    // Try gemini-1.5-flash for speed/cost, fallback to pro if needed
    // Changing to gemini-1.5-flash as it is generally more available on free tier for high volume
    // But user requested "Lateast Model". gemini-1.5-pro is latest stable.
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
