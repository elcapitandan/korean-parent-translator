import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROFILES_FILE = join(__dirname, '../data/profiles.json');

// Default translation profiles
export const DEFAULT_PROFILES = [
    {
        id: 'natural',
        name: 'Natural',
        description: 'Give a rough translation using common phrases instead of a direct translation to make the translation seem more natural',
        rules: [
            'Use common expressions and idioms in the target language',
            'Prioritize natural flow over literal accuracy',
            'Adapt cultural references to be more understandable'
        ],
        isDefault: true,
        canDelete: false
    },
    {
        id: 'parent-talk',
        name: 'Parent Talk',
        description: 'Give a rough translation based on informal Korean but appropriate for talking to your parents',
        rules: [
            'Use respectful but warm language (존댓말 with friendly tone)',
            'Avoid overly formal or stiff expressions',
            'Include appropriate honorifics for parents',
            'Soften direct statements to be more respectful'
        ],
        isDefault: true,
        canDelete: false
    },
    {
        id: 'direct',
        name: 'Direct',
        description: 'Provide a literal word-for-word translation preserving the exact meaning',
        rules: [
            'Translate as literally as possible',
            'Preserve original sentence structure when possible',
            'Keep cultural references intact with explanation if needed'
        ],
        isDefault: true,
        canDelete: false
    }
];

// Load profiles from file
function loadProfiles() {
    try {
        if (existsSync(PROFILES_FILE)) {
            const data = readFileSync(PROFILES_FILE, 'utf-8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.error('Error loading profiles:', error);
    }
    return [];
}

// Save profiles to file
function saveProfilesToFile(customProfiles) {
    try {
        const dir = dirname(PROFILES_FILE);
        if (!existsSync(dir)) {
            import('fs').then(fs => fs.mkdirSync(dir, { recursive: true }));
        }
        writeFileSync(PROFILES_FILE, JSON.stringify(customProfiles, null, 2));
    } catch (error) {
        console.error('Error saving profiles:', error);
    }
}

// Get all profiles (defaults + custom)
export function getProfiles() {
    const customProfiles = loadProfiles();
    return [...DEFAULT_PROFILES, ...customProfiles];
}

// Get a specific profile by ID
export function getProfileById(id) {
    return getProfiles().find(p => p.id === id);
}

// Save a custom profile
export function saveProfile(profile) {
    if (!profile.name || !profile.description) {
        throw new Error('Profile must have a name and description');
    }

    const customProfiles = loadProfiles();
    const existingIndex = customProfiles.findIndex(p => p.id === profile.id);

    const newProfile = {
        id: profile.id || `custom-${Date.now()}`,
        name: profile.name,
        description: profile.description,
        rules: profile.rules || [],
        isDefault: false,
        canDelete: true
    };

    if (existingIndex >= 0) {
        customProfiles[existingIndex] = newProfile;
    } else {
        customProfiles.push(newProfile);
    }

    saveProfilesToFile(customProfiles);
    return newProfile;
}

// Delete a custom profile
export function deleteProfile(id) {
    const profile = getProfileById(id);
    if (!profile) {
        throw new Error('Profile not found');
    }
    if (!profile.canDelete) {
        throw new Error('Cannot delete default profiles');
    }

    const customProfiles = loadProfiles().filter(p => p.id !== id);
    saveProfilesToFile(customProfiles);
}
