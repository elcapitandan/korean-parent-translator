import express from 'express';
import cors from 'cors';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { translateText, getAlternatives, generateVariation } from './services/ai.js';
import { getProfiles, saveProfile, deleteProfile } from './services/profiles.js';

config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Serve static files from the built frontend in production
const distPath = join(__dirname, '../dist');
app.use(express.static(distPath));

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', hasApiKey: !!process.env.GEMINI_API_KEY });
});

// Main translation endpoint
app.post('/api/translate', async (req, res) => {
    try {
        const { text, profileId, customRules } = req.body;

        if (!text || text.trim() === '') {
            return res.status(400).json({ error: 'Text is required' });
        }

        const result = await translateText(text, profileId, customRules);
        res.json(result);
    } catch (error) {
        console.error('Translation error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get word alternatives for highlighted text
app.post('/api/alternatives', async (req, res) => {
    try {
        const { word, context, sourceLanguage, targetLanguage } = req.body;

        if (!word) {
            return res.status(400).json({ error: 'Word is required' });
        }

        const alternatives = await getAlternatives(word, context, sourceLanguage, targetLanguage);
        res.json({ alternatives });
    } catch (error) {
        console.error('Alternatives error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Generate translation variation
app.post('/api/variation', async (req, res) => {
    try {
        const { originalText, currentTranslation, profileId } = req.body;

        const variation = await generateVariation(originalText, currentTranslation, profileId);
        res.json(variation);
    } catch (error) {
        console.error('Variation error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Profile management
app.get('/api/profiles', (req, res) => {
    res.json(getProfiles());
});

app.post('/api/profiles', (req, res) => {
    try {
        const profile = saveProfile(req.body);
        res.json(profile);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

app.delete('/api/profiles/:id', (req, res) => {
    try {
        deleteProfile(req.params.id);
        res.json({ success: true });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// Serve frontend for all other routes (SPA support)
app.get('*', (req, res) => {
    res.sendFile(join(distPath, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
    if (!process.env.GEMINI_API_KEY) {
        console.warn('⚠️  GEMINI_API_KEY not set. Add it to your environment variables.');
    }
});
