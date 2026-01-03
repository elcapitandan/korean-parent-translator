import * as api from './api.js';
import { ProfileManager } from './profiles.js';
import { AlternativesPopup } from './alternatives.js';

// App State
const state = {
    currentTranslation: null,
    selectedProfile: 'natural',
    debounceTimer: null
};

// DOM Elements
const elements = {
    inputText: document.getElementById('input-text'),
    translationOutput: document.getElementById('translation-output'),
    translationNotes: document.getElementById('translation-notes'),
    retranslationOutput: document.getElementById('retranslation-output'),
    profileSelect: document.getElementById('profile-select'),
    charCount: document.getElementById('char-count'),
    sourceLang: document.getElementById('source-lang'),
    targetLang: document.getElementById('target-lang'),
    accuracyScore: document.getElementById('accuracy-score'),
    accuracyExplanation: document.getElementById('accuracy-explanation'),
    profileBadge: document.getElementById('profile-badge'),
    copyBtn: document.getElementById('copy-btn'),
    variationBtn: document.getElementById('variation-btn'),
    clearBtn: document.getElementById('clear-btn'),
    manageProfilesBtn: document.getElementById('manage-profiles-btn'),
    loadingOverlay: document.getElementById('loading-overlay'),
    apiStatus: document.getElementById('api-status')
};

// Initialize managers
const profileManager = new ProfileManager();
const alternativesPopup = new AlternativesPopup();

// Initialize app
async function init() {
    // Check API health
    await checkApiStatus();

    // Load profiles
    await loadProfiles();

    // Set up event listeners
    setupEventListeners();

    // Focus input
    elements.inputText.focus();
}

// Check API connection
async function checkApiStatus() {
    const statusDot = elements.apiStatus.querySelector('.status-dot');
    const statusText = elements.apiStatus.querySelector('.status-text');

    try {
        const health = await api.checkHealth();
        if (health.hasApiKey) {
            statusDot.className = 'status-dot connected';
            statusText.textContent = 'Connected';
        } else {
            statusDot.className = 'status-dot error';
            statusText.textContent = 'No API Key';
        }
    } catch (error) {
        statusDot.className = 'status-dot error';
        statusText.textContent = 'Server Offline';
    }
}

// Load profiles into dropdown
async function loadProfiles() {
    try {
        const profiles = await api.getProfiles();
        elements.profileSelect.innerHTML = '';

        profiles.forEach(profile => {
            const option = document.createElement('option');
            option.value = profile.id;
            option.textContent = profile.name;
            if (profile.id === state.selectedProfile) {
                option.selected = true;
            }
            elements.profileSelect.appendChild(option);
        });

        profileManager.setProfiles(profiles);
        updateProfileBadge();
    } catch (error) {
        console.error('Failed to load profiles:', error);
    }
}

// Set up event listeners
function setupEventListeners() {
    // Input text change with debounce
    elements.inputText.addEventListener('input', () => {
        const text = elements.inputText.value;
        elements.charCount.textContent = text.length;

        // Debounce translation
        clearTimeout(state.debounceTimer);
        if (text.trim()) {
            state.debounceTimer = setTimeout(() => translateText(text), 800);
        } else {
            clearTranslation();
        }
    });

    // Profile change
    elements.profileSelect.addEventListener('change', () => {
        state.selectedProfile = elements.profileSelect.value;
        updateProfileBadge();

        // Re-translate with new profile
        const text = elements.inputText.value.trim();
        if (text) {
            translateText(text);
        }
    });

    // Copy button
    elements.copyBtn.addEventListener('click', copyTranslation);

    // Variation button
    elements.variationBtn.addEventListener('click', generateNewVariation);

    // Clear button
    elements.clearBtn.addEventListener('click', () => {
        elements.inputText.value = '';
        elements.charCount.textContent = '0';
        clearTranslation();
    });

    // Manage profiles
    elements.manageProfilesBtn.addEventListener('click', () => {
        profileManager.open();
    });

    // Profile manager events
    profileManager.onSave = async () => {
        await loadProfiles();
    };

    // Text selection for alternatives
    elements.translationOutput.addEventListener('mouseup', handleTextSelection);

    // Alternatives popup events
    alternativesPopup.onSelect = (selectedText, replacement) => {
        replaceInTranslation(selectedText, replacement);
    };
}

// Translate text
async function translateText(text) {
    showLoading(true);

    try {
        const result = await api.translate(text, state.selectedProfile);
        state.currentTranslation = result;

        // Update source/target language badges
        updateLanguageBadges(result.sourceLanguage, result.targetLanguage);

        // Update translation panel
        elements.translationOutput.innerHTML = `<p>${makeSelectable(result.translation)}</p>`;

        if (result.translationNotes) {
            elements.translationNotes.textContent = result.translationNotes;
            elements.translationNotes.classList.remove('hidden');
        } else {
            elements.translationNotes.classList.add('hidden');
        }

        // Update re-translation panel
        elements.retranslationOutput.innerHTML = `<p>${result.reTranslation}</p>`;

        // Update accuracy score
        updateAccuracyScore(result.accuracyScore);

        // Enable action buttons
        elements.copyBtn.disabled = false;
        elements.variationBtn.disabled = false;

    } catch (error) {
        console.error('Translation error:', error);
        elements.translationOutput.innerHTML = `<p class="placeholder" style="color: var(--error);">Error: ${error.message}</p>`;
    } finally {
        showLoading(false);
    }
}

// Make text selectable for alternatives popup
function makeSelectable(text) {
    // Split by words/phrases but keep punctuation
    return text;
}

// Handle text selection
function handleTextSelection(event) {
    const selection = window.getSelection();
    const selectedText = selection.toString().trim();

    if (selectedText && state.currentTranslation) {
        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();

        alternativesPopup.show(
            selectedText,
            state.currentTranslation.translation,
            state.currentTranslation.sourceLanguage,
            state.currentTranslation.targetLanguage,
            { x: rect.left, y: rect.bottom + 10 }
        );
    }
}

// Replace text in translation
function replaceInTranslation(originalText, replacement) {
    if (!state.currentTranslation) return;

    const newTranslation = state.currentTranslation.translation.replace(originalText, replacement);
    state.currentTranslation.translation = newTranslation;
    elements.translationOutput.innerHTML = `<p>${newTranslation}</p>`;

    // Re-validate with new translation
    revalidateTranslation();
}

// Re-validate translation after edit
async function revalidateTranslation() {
    if (!state.currentTranslation) return;

    try {
        const result = await api.translate(
            state.currentTranslation.translation,
            'direct'
        );

        elements.retranslationOutput.innerHTML = `<p>${result.translation}</p>`;

        // Recalculate accuracy against original input
        // For now, just show the new re-translation
    } catch (error) {
        console.error('Re-validation error:', error);
    }
}

// Update language badges
function updateLanguageBadges(source, target) {
    elements.sourceLang.textContent = source === 'ko' ? '한국어' : 'English';
    elements.sourceLang.className = `language-badge ${source}`;

    elements.targetLang.textContent = target === 'ko' ? '한국어' : 'English';
    elements.targetLang.className = `language-badge ${target}`;
}

// Update accuracy score display
function updateAccuracyScore(accuracyData) {
    const scoreValue = elements.accuracyScore.querySelector('.score-value');
    const score = accuracyData.score;

    scoreValue.textContent = `${score}%`;
    scoreValue.className = 'score-value';

    if (score >= 85) {
        scoreValue.classList.add('high');
    } else if (score >= 70) {
        scoreValue.classList.add('medium');
    } else {
        scoreValue.classList.add('low');
    }

    elements.accuracyExplanation.textContent = accuracyData.explanation;
}

// Update profile badge
function updateProfileBadge() {
    const option = elements.profileSelect.options[elements.profileSelect.selectedIndex];
    elements.profileBadge.textContent = `Using: ${option ? option.textContent : 'Natural'}`;
}

// Copy translation to clipboard
async function copyTranslation() {
    if (!state.currentTranslation) return;

    try {
        await navigator.clipboard.writeText(state.currentTranslation.translation);

        // Visual feedback
        const originalText = elements.copyBtn.innerHTML;
        elements.copyBtn.innerHTML = '✓ Copied!';
        setTimeout(() => {
            elements.copyBtn.innerHTML = originalText;
        }, 2000);
    } catch (error) {
        console.error('Copy failed:', error);
    }
}

// Generate new variation
async function generateNewVariation() {
    if (!state.currentTranslation) return;

    showLoading(true);

    try {
        const result = await api.generateVariation(
            state.currentTranslation.original,
            state.currentTranslation.translation,
            state.selectedProfile
        );

        state.currentTranslation.translation = result.translation;
        elements.translationOutput.innerHTML = `<p>${result.translation}</p>`;

        if (result.difference) {
            elements.translationNotes.textContent = `Variation: ${result.difference}`;
            elements.translationNotes.classList.remove('hidden');
        }

        // Re-validate
        await revalidateTranslation();

    } catch (error) {
        console.error('Variation error:', error);
        elements.translationNotes.textContent = `Variation failed: ${error.message}`;
        elements.translationNotes.classList.remove('hidden');
    } finally {
        showLoading(false);
    }
}

// Clear translation panels
function clearTranslation() {
    state.currentTranslation = null;

    elements.translationOutput.innerHTML = '<p class="placeholder">Translation will appear here...</p>';
    elements.translationNotes.classList.add('hidden');
    elements.retranslationOutput.innerHTML = '<p class="placeholder">Direct re-translation for validation...</p>';

    elements.sourceLang.textContent = 'Auto-detect';
    elements.sourceLang.className = 'language-badge';
    elements.targetLang.textContent = '—';
    elements.targetLang.className = 'language-badge';

    const scoreValue = elements.accuracyScore.querySelector('.score-value');
    scoreValue.textContent = '—';
    scoreValue.className = 'score-value';
    elements.accuracyExplanation.textContent = 'Compare with your original to check for meaning loss';

    elements.copyBtn.disabled = true;
    elements.variationBtn.disabled = true;
}

// Show/hide loading in translation panel only
function showLoading(show) {
    if (show) {
        elements.translationOutput.innerHTML = `
            <div class="panel-loading">
                <div class="loading-spinner-small"></div>
                <span>Translating...</span>
            </div>
        `;
    }
}

// Start the app
init();
