import * as deepl from 'deepl-node';
import OpenAI from 'openai';
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { getProfileById, DEFAULT_PROFILES } from './profiles.js';

// Get proper path to .env in project root
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '../../.env') });

// Initialize clients
let deeplTranslator = null;
let perplexityClient = null;

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

function getPerplexity() {
    if (!perplexityClient) {
        const apiKey = process.env.PERPLEXITY_API_KEY || '';
        if (!apiKey) {
            console.warn('Perplexity API Key is missing!');
        }
        perplexityClient = new OpenAI({
            apiKey: apiKey,
            baseURL: 'https://api.perplexity.ai'
        });
    }
    return perplexityClient;
}

// Detect language (Korean or English)
function detectLanguage(text) {
    const koreanRegex = /[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/;
    const koreanChars = (text.match(koreanRegex) || []).length;
    const totalChars = text.replace(/\s/g, '').length;

    return koreanChars / totalChars > 0.3 ? 'ko' : 'en';
}

// Apply custom rules to transform text using Perplexity AI
async function applyCustomRules(text, rules, sourceLanguage) {
    if (!rules || rules.length === 0) {
        return { transformedText: text, appliedRules: [] };
    }

    const perplexity = getPerplexity();
    const rulesText = rules.map((r, i) => `${i + 1}. ${r}`).join('\n');
    const languageName = sourceLanguage === 'ko' ? 'Korean' : 'English';

    const prompt = `You are a text transformation assistant. Transform the following ${languageName} text according to the given rules.

ORIGINAL TEXT:
"${text}"

RULES TO APPLY:
${rulesText}

IMPORTANT:
- Keep the text in ${languageName} (do NOT translate)
- Apply ALL the rules to transform the meaning, tone, or style
- Return ONLY the transformed text, nothing else
- If a rule doesn't apply, skip it
- Preserve the core meaning while applying the rules

TRANSFORMED TEXT:`;

    try {
        const response = await perplexity.chat.completions.create({
            model: 'sonar',
            messages: [
                { role: 'user', content: prompt }
            ],
            max_tokens: 500,
            temperature: 0.7
        });

        const transformedText = response.choices[0].message.content.trim();

        // Clean up any quotes that might wrap the response
        const cleaned = transformedText.replace(/^["']|["']$/g, '').trim();

        return {
            transformedText: cleaned || text,
            appliedRules: rules
        };
    } catch (error) {
        console.error('Perplexity rule application error:', error.message);
        // Return original text if Perplexity fails
        return {
            transformedText: text,
            appliedRules: [],
            error: error.message
        };
    }
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

// Main translation function - DeepL with optional Perplexity rule transformation
export async function translateText(text, profileId = 'natural', customRules = []) {
    const sourceLanguage = detectLanguage(text);
    const targetLanguage = sourceLanguage === 'ko' ? 'en-US' : 'ko';

    // Step 1: Apply custom rules using Perplexity (if any)
    let textToTranslate = text;
    let ruleTransformation = null;

    if (customRules && customRules.length > 0) {
        console.log('Applying custom rules via Perplexity:', customRules);
        ruleTransformation = await applyCustomRules(text, customRules, sourceLanguage);
        textToTranslate = ruleTransformation.transformedText;
        console.log('Transformed text:', textToTranslate);
    }

    // Step 2: Translate with DeepL
    const translator = getDeepL();

    // Map profiles to DeepL formality
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
            // Only apply formality when translating TO Korean
            const options = targetLanguage === 'ko' ? { formality } : {};
            translationResult = await translator.translateText(textToTranslate, null, targetLanguage, options);
        } catch (e) {
            console.warn('Formality not supported, using default:', e.message);
            translationResult = await translator.translateText(textToTranslate, null, targetLanguage);
        }

        const translatedText = translationResult.text;

        // Back-Translation using DeepL with DIRECT/LITERAL mode
        const backTarget = sourceLanguage === 'ko' ? 'ko' : 'en-US';
        const backOptions = backTarget === 'ko' ? { formality: 'prefer_less' } : {};
        const backTranslationResult = await translator.translateText(translatedText, null, backTarget, backOptions);
        const backTranslatedText = backTranslationResult.text;

        // Calculate accuracy score
        const accuracyScore = calculateTextSimilarity(text, backTranslatedText);

        // Build notes
        let notes = profileNote;
        if (ruleTransformation && ruleTransformation.appliedRules.length > 0) {
            notes = `Rules applied: ${ruleTransformation.appliedRules.join(', ')}`;
            if (ruleTransformation.transformedText !== text) {
                notes += ` | Transformed: "${ruleTransformation.transformedText}"`;
            }
        }

        return {
            original: text,
            sourceLanguage,
            targetLanguage: targetLanguage === 'en-US' ? 'en' : 'ko',
            translation: translatedText,
            translationConfidence: 1.0,
            translationNotes: notes,
            reTranslation: backTranslatedText,
            reTranslationNotes: '',
            accuracyScore,
            profileUsed: getProfileById(profileId)?.name || 'DeepL',
            transformedText: ruleTransformation?.transformedText !== text ? ruleTransformation?.transformedText : null
        };

    } catch (error) {
        console.error('Translation Error:', error);
        throw new Error(`Translation Error: ${error.message}`);
    }
}

// Get alternative translations - placeholder
export async function getAlternatives(word, context, sourceLanguage, targetLanguage) {
    return [
        { text: word, nuance: 'Original translation (DeepL)' }
    ];
}

// Generate a different variation using Perplexity to rephrase, then DeepL to translate
export async function generateVariation(originalText, currentTranslation, profileId, customRules = []) {
    const originalLanguage = detectLanguage(originalText);
    const translationLanguage = originalLanguage === 'ko' ? 'en-US' : 'ko';

    const perplexity = getPerplexity();
    const translator = getDeepL();
    const languageName = originalLanguage === 'ko' ? 'Korean' : 'English';

    try {
        // Use Perplexity to generate a rephrased version of the original
        const prompt = `Rephrase this ${languageName} text in a different way while keeping the same meaning. Use different words, sentence structure, or style.

ORIGINAL: "${originalText}"

Rules to consider: ${customRules.length > 0 ? customRules.join(', ') : 'None - just rephrase naturally'}

Return ONLY the rephrased text in ${languageName}, nothing else:`;

        const response = await perplexity.chat.completions.create({
            model: 'sonar',
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 300,
            temperature: 0.9  // Higher temperature for more variation
        });

        const rephrasedText = response.choices[0].message.content.trim().replace(/^["']|["']$/g, '');

        // Now translate the rephrased text with DeepL
        const options = translationLanguage === 'ko' ? { formality: 'default' } : {};
        const result = await translator.translateText(rephrasedText, null, translationLanguage, options);

        if (result.text === currentTranslation) {
            return {
                translation: currentTranslation,
                difference: 'Generated similar translation. Try adding custom rules for more variety.'
            };
        }

        return {
            translation: result.text,
            difference: `Rephrased from: "${rephrasedText}"`
        };

    } catch (error) {
        console.error('Variation Error:', error.message);
        return {
            translation: currentTranslation,
            difference: `Variation unavailable: ${error.message}`
        };
    }
}
