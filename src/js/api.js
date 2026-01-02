// API Service for communicating with backend
const API_BASE = '/api';

export async function checkHealth() {
    const response = await fetch(`${API_BASE}/health`);
    return response.json();
}

export async function translate(text, profileId, customRules = []) {
    const response = await fetch(`${API_BASE}/translate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, profileId, customRules })
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Translation failed');
    }

    return response.json();
}

export async function getAlternatives(word, context, sourceLanguage, targetLanguage) {
    const response = await fetch(`${API_BASE}/alternatives`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ word, context, sourceLanguage, targetLanguage })
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to get alternatives');
    }

    return response.json();
}

export async function generateVariation(originalText, currentTranslation, profileId) {
    const response = await fetch(`${API_BASE}/variation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ originalText, currentTranslation, profileId })
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to generate variation');
    }

    return response.json();
}

export async function getProfiles() {
    const response = await fetch(`${API_BASE}/profiles`);
    return response.json();
}

export async function saveProfile(profile) {
    const response = await fetch(`${API_BASE}/profiles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profile)
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to save profile');
    }

    return response.json();
}

export async function deleteProfile(id) {
    const response = await fetch(`${API_BASE}/profiles/${id}`, {
        method: 'DELETE'
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to delete profile');
    }

    return response.json();
}
