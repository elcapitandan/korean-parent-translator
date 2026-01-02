import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { getProfileById, DEFAULT_PROFILES } from './profiles.js';

// Get proper path to .env in project root
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '../../.env') });

// Initialize after dotenv loads
let genAI = null;
function getGenAI() {
    if (!genAI) {
        genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
    }
    return genAI;
}
// Detect language (Korean or English)
function detectLanguage(text) {
    const koreanRegex = /[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/;
    const koreanChars = (text.match(koreanRegex) || []).length;
    const totalChars = text.replace(/\s/g, '').length;

    return koreanChars / totalChars > 0.3 ? 'ko' : 'en';
}

// Build translation prompt based on profile
function buildTranslationPrompt(text, profile, sourceLanguage) {
    const targetLanguage = sourceLanguage === 'ko' ? 'English' : 'Korean';
    const sourceName = sourceLanguage === 'ko' ? 'Korean' : 'English';

    let prompt = `Translate the following ${sourceName} text to ${targetLanguage}.\n\n`;

    if (profile) {
        prompt += `Translation style: ${profile.description}\n`;
        if (profile.rules && profile.rules.length > 0) {
            prompt += `Rules to follow:\n${profile.rules.map(r => `- ${r}`).join('\n')}\n`;
        }
    }

    prompt += `\nText to translate:\n"${text}"\n\n`;
    prompt += `Respond with ONLY a JSON object in this exact format:
{
  "translation": "the translated text",
  "confidence": 0.95,
  "notes": "any relevant notes about the translation"
}`;

    return prompt;
}

// Main translation function
export async function translateText(text, profileId = 'natural', customRules = []) {
    const model = getGenAI().getGenerativeModel({ model: 'gemini-2.5-flash' });

    const sourceLanguage = detectLanguage(text);
    const profile = getProfileById(profileId) || DEFAULT_PROFILES[0];

    // Merge custom rules if provided
    const effectiveProfile = customRules.length > 0
        ? { ...profile, rules: [...(profile.rules || []), ...customRules] }
        : profile;

    // Get main translation
    const mainPrompt = buildTranslationPrompt(text, effectiveProfile, sourceLanguage);
    const mainResult = await model.generateContent(mainPrompt);
    const mainResponse = mainResult.response.text();

    let mainTranslation;
    try {
        const jsonMatch = mainResponse.match(/\{[\s\S]*\}/);
        mainTranslation = JSON.parse(jsonMatch ? jsonMatch[0] : mainResponse);
    } catch {
        mainTranslation = { translation: mainResponse, confidence: 0.8, notes: '' };
    }

    // Get direct re-translation for validation
    // Get re-translation for validation (Literal but Natural)
    const targetLanguage = sourceLanguage === 'ko' ? 'en' : 'ko';

    // Use a custom profile for back-translation to ensure it sounds natural in English
    const validationProfile = {
        description: 'Provide a natural translation that preserves the exact meaning but sounds like a native speaker',
        rules: [
            'Avoid robotic or awkwardly literal translations (e.g., translate "badatga" as "beach", not "sea\'s edge")',
            'Use natural phrasing that a native speaker would actually say',
            'Preserve the original intent and tone',
            'Do not add new information, but do not be afraid to rearrange structure for natural flow'
        ]
    };

    const reTranslatePrompt = buildTranslationPrompt(mainTranslation.translation, validationProfile, targetLanguage);
    const reResult = await model.generateContent(reTranslatePrompt);
    const reResponse = reResult.response.text();

    let reTranslation;
    try {
        const jsonMatch = reResponse.match(/\{[\s\S]*\}/);
        reTranslation = JSON.parse(jsonMatch ? jsonMatch[0] : reResponse);
    } catch {
        reTranslation = { translation: reResponse, confidence: 0.8, notes: '' };
    }

    // Calculate accuracy score
    const accuracyScore = await calculateAccuracyScore(text, reTranslation.translation, sourceLanguage);

    return {
        original: text,
        sourceLanguage,
        targetLanguage,
        translation: mainTranslation.translation,
        translationConfidence: mainTranslation.confidence,
        translationNotes: mainTranslation.notes,
        reTranslation: reTranslation.translation,
        reTranslationNotes: reTranslation.notes,
        accuracyScore,
        profileUsed: effectiveProfile.name
    };
}

// Calculate semantic similarity between original and re-translation
async function calculateAccuracyScore(original, reTranslation, language) {
    const model = getGenAI().getGenerativeModel({ model: 'gemini-2.5-flash' });

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

// Get alternative translations for a word/phrase
export async function getAlternatives(word, context, sourceLanguage, targetLanguage) {
    const model = getGenAI().getGenerativeModel({ model: 'gemini-2.5-flash' });

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

// Generate a different variation of the translation
export async function generateVariation(originalText, currentTranslation, profileId) {
    const model = getGenAI().getGenerativeModel({ model: 'gemini-2.5-flash' });
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
