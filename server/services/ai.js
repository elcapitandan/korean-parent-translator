import * as deepl from 'deepl-node';
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { getProfileById, DEFAULT_PROFILES } from './profiles.js';

// Get proper path to .env in project root
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '../../.env') });

// Initialize DeepL client
let deeplTranslator = null;

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

// Calculate text similarity score (0-100) using token overlap
function calculateTextSimilarity(original, backTranslation) {
    const normalize = (text) => text.toLowerCase().replace(/[^\w\s가-힣]/g, '').trim();
    const tokenize = (text) => normalize(text).split(/\s+/).filter(t => t.length > 0);

    const originalTokens = tokenize(original);
    const backTokens = tokenize(backTranslation);

    if (originalTokens.length === 0 || backTokens.length === 0) {
        return { score: 0, explanation: 'Unable to compare texts' };
    }

    // Count matching tokens
    const originalSet = new Set(originalTokens);
    const backSet = new Set(backTokens);

    let matchCount = 0;
    for (const token of originalSet) {
        if (backSet.has(token)) {
            matchCount++;
        }
    }

    // Calculate Jaccard similarity
    const unionSize = new Set([...originalTokens, ...backTokens]).size;
    const jaccardScore = (matchCount / unionSize) * 100;

    // Also consider length similarity
    const lengthRatio = Math.min(originalTokens.length, backTokens.length) /
        Math.max(originalTokens.length, backTokens.length);

    // Combined score (weighted average)
    const combinedScore = Math.round((jaccardScore * 0.7) + (lengthRatio * 100 * 0.3));

    let explanation = '';
    if (combinedScore >= 85) {
        explanation = 'Excellent semantic preservation';
    } else if (combinedScore >= 70) {
        explanation = 'Good meaning retention with minor variations';
    } else if (combinedScore >= 50) {
        explanation = 'Moderate similarity - some nuances may differ';
    } else {
        explanation = 'Translation may have significant interpretation';
    }

    return {
        score: Math.min(100, Math.max(0, combinedScore)),
        explanation
    };
}

// Main translation function - DeepL only
export async function translateText(text, profileId = 'natural', customRules = []) {
    const sourceLanguage = detectLanguage(text);
    const targetLanguage = sourceLanguage === 'ko' ? 'en-US' : 'ko';

    const translator = getDeepL();

    // Map profiles to DeepL formality
    // Natural -> Formal (for speaking to elders) -> prefer_more
    // Parent Talk -> Polite/Standard -> default
    // Direct -> No formality preference (literal) -> prefer_less
    let formality = 'default';
    let profileNote = '';

    if (profileId === 'natural') {
        formality = 'prefer_more';
        profileNote = 'Using formal tone for respectful communication';
    } else if (profileId === 'parent-talk') {
        formality = 'default';
        profileNote = 'Using standard polite tone';
    } else if (profileId === 'direct') {
        formality = 'prefer_less';
        profileNote = 'Using direct/literal translation style';
    }

    try {
        let translationResult;
        try {
            // Only apply formality when translating TO Korean (not from Korean to English)
            const options = targetLanguage === 'ko' ? { formality } : {};
            translationResult = await translator.translateText(text, null, targetLanguage, options);
        } catch (e) {
            // Fallback if formality not supported
            console.warn('Formality not supported, using default:', e.message);
            translationResult = await translator.translateText(text, null, targetLanguage);
        }

        const translatedText = translationResult.text;

        // Back-Translation using DeepL with DIRECT/LITERAL mode
        // Translate the AI result back to the source language to verify what it actually means
        const backTarget = sourceLanguage === 'ko' ? 'ko' : 'en-US';
        // Use prefer_less (literal/direct) for accurate back-translation
        const backOptions = backTarget === 'ko' ? { formality: 'prefer_less' } : {};
        const backTranslationResult = await translator.translateText(translatedText, null, backTarget, backOptions);
        const backTranslatedText = backTranslationResult.text;

        // Calculate accuracy score using text similarity
        const accuracyScore = calculateTextSimilarity(text, backTranslatedText);

        return {
            original: text,
            sourceLanguage,
            targetLanguage: targetLanguage === 'en-US' ? 'en' : 'ko',
            translation: translatedText,
            translationConfidence: 1.0,
            translationNotes: profileNote,
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

// Get alternative translations - simplified without Gemini
// Returns variations by trying different formality settings
export async function getAlternatives(word, context, sourceLanguage, targetLanguage) {
    // Without Gemini, we can't generate true alternatives
    // Return a message indicating this feature requires AI
    return [
        { text: word, nuance: 'Original translation (DeepL)' },
        { text: word, nuance: 'Alternative suggestions require AI features' }
    ];
}

// Generate a different variation of the CURRENT TRANSLATION
// This works by translating the current translation back and forth with different formality
export async function generateVariation(originalText, currentTranslation, profileId) {
    // Detect language of the CURRENT TRANSLATION (which is opposite of original)
    const originalLanguage = detectLanguage(originalText);
    const translationLanguage = originalLanguage === 'ko' ? 'en-US' : 'ko';
    // For variation, we translate the current translation back to original language, then forward again with different style
    const backToOriginal = originalLanguage === 'ko' ? 'ko' : 'en-US';

    const translator = getDeepL();

    try {
        // Step 1: Translate the current translation back to original language (direct/literal)
        const backOptions = backToOriginal === 'ko' ? { formality: 'prefer_less' } : {};
        const backResult = await translator.translateText(currentTranslation, null, backToOriginal, backOptions);
        const backText = backResult.text;

        // Step 2: Translate that back to target language with a DIFFERENT formality
        const formalityOptions = ['prefer_less', 'default', 'prefer_more'];

        // Find current formality based on profile
        let currentFormality = 'default';
        if (profileId === 'natural') currentFormality = 'prefer_more';
        else if (profileId === 'direct') currentFormality = 'prefer_less';

        // Pick a different formality
        const otherFormalities = formalityOptions.filter(f => f !== currentFormality);
        const newFormality = otherFormalities[Math.floor(Math.random() * otherFormalities.length)];

        // Translate with new formality
        const forwardOptions = translationLanguage === 'ko' ? { formality: newFormality } : {};
        const result = await translator.translateText(backText, null, translationLanguage, forwardOptions);
        const newTranslation = result.text;

        // Check if we actually got a different translation
        if (newTranslation === currentTranslation) {
            // Try with a different formality
            const alternateFormality = otherFormalities.find(f => f !== newFormality) || 'default';
            const altOptions = translationLanguage === 'ko' ? { formality: alternateFormality } : {};
            const altResult = await translator.translateText(backText, null, translationLanguage, altOptions);

            if (altResult.text !== currentTranslation) {
                return {
                    translation: altResult.text,
                    difference: alternateFormality === 'prefer_more' ? 'More formal/polite variation' :
                        alternateFormality === 'prefer_less' ? 'More casual/direct variation' :
                            'Standard formality variation'
                };
            }

            return {
                translation: currentTranslation,
                difference: 'This translation is already optimal. Try a different phrase.'
            };
        }

        // Describe the difference
        let differenceNote = '';
        if (newFormality === 'prefer_more') {
            differenceNote = 'More formal/polite variation';
        } else if (newFormality === 'prefer_less') {
            differenceNote = 'More casual/direct variation';
        } else {
            differenceNote = 'Standard formality variation';
        }

        return {
            translation: newTranslation,
            difference: differenceNote
        };

    } catch (error) {
        console.error('Variation Error:', error.message);
        return {
            translation: currentTranslation,
            difference: `Variation unavailable: ${error.message}`
        };
    }
}
