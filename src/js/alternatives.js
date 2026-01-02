import * as api from './api.js';

export class AlternativesPopup {
    constructor() {
        this.popup = document.getElementById('alternatives-popup');
        this.list = document.getElementById('alternatives-list');
        this.selectedText = '';
        this.onSelect = null;

        this.setupEventListeners();
    }

    setupEventListeners() {
        // Close popup
        document.getElementById('close-popup').addEventListener('click', () => this.hide());

        // Close on click outside
        document.addEventListener('click', (e) => {
            if (!this.popup.contains(e.target) && !this.popup.classList.contains('hidden')) {
                // Check if click is in translation output
                const translationOutput = document.getElementById('translation-output');
                if (!translationOutput.contains(e.target)) {
                    this.hide();
                }
            }
        });

        // Close on escape
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.hide();
            }
        });
    }

    async show(selectedText, context, sourceLanguage, targetLanguage, position) {
        this.selectedText = selectedText;

        // Position popup
        this.popup.style.left = `${Math.max(10, position.x)}px`;
        this.popup.style.top = `${position.y}px`;

        // Show loading state
        this.list.innerHTML = '<div class="alternative-item"><p style="color: var(--text-muted);">Loading alternatives...</p></div>';
        this.popup.classList.remove('hidden');

        try {
            const result = await api.getAlternatives(selectedText, context, sourceLanguage, targetLanguage);
            this.renderAlternatives(result.alternatives);
        } catch (error) {
            this.list.innerHTML = `<div class="alternative-item"><p style="color: var(--error);">Error: ${error.message}</p></div>`;
        }
    }

    renderAlternatives(alternatives) {
        this.list.innerHTML = '';

        if (!alternatives || alternatives.length === 0) {
            this.list.innerHTML = '<div class="alternative-item"><p style="color: var(--text-muted);">No alternatives found</p></div>';
            return;
        }

        alternatives.forEach(alt => {
            const item = document.createElement('div');
            item.className = 'alternative-item';

            item.innerHTML = `
        <div class="alternative-text">${alt.text}</div>
        <div class="alternative-nuance">${alt.nuance}</div>
      `;

            item.addEventListener('click', () => {
                if (this.onSelect) {
                    this.onSelect(this.selectedText, alt.text);
                }
                this.hide();
            });

            this.list.appendChild(item);
        });
    }

    hide() {
        this.popup.classList.add('hidden');
        this.selectedText = '';
    }
}
