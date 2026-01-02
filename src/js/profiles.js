import * as api from './api.js';

export class ProfileManager {
    constructor() {
        this.profiles = [];
        this.editingProfile = null;
        this.onSave = null;

        this.modal = document.getElementById('profile-modal');
        this.profilesList = document.getElementById('profiles-list');
        this.rulesList = document.getElementById('rules-list');
        this.formTitle = document.getElementById('form-title');

        this.setupEventListeners();
    }

    setupEventListeners() {
        // Close modal
        document.getElementById('close-modal').addEventListener('click', () => this.close());
        this.modal.querySelector('.modal-backdrop').addEventListener('click', () => this.close());

        // Add rule
        document.getElementById('add-rule-btn').addEventListener('click', () => this.addRuleInput());

        // Save profile
        document.getElementById('save-profile-btn').addEventListener('click', () => this.saveProfile());

        // Cancel
        document.getElementById('cancel-profile-btn').addEventListener('click', () => this.resetForm());
    }

    setProfiles(profiles) {
        this.profiles = profiles;
    }

    open() {
        this.renderProfiles();
        this.resetForm();
        this.modal.classList.remove('hidden');
    }

    close() {
        this.modal.classList.add('hidden');
        this.resetForm();
    }

    renderProfiles() {
        this.profilesList.innerHTML = '';

        this.profiles.forEach(profile => {
            const item = document.createElement('div');
            item.className = `profile-item${profile.isDefault ? ' default' : ''}`;

            item.innerHTML = `
        <div class="profile-info">
          <h4>${profile.name}${profile.isDefault ? ' <span style="font-size: 0.75rem; color: var(--accent-primary);">(Default)</span>' : ''}</h4>
          <p>${profile.description}</p>
        </div>
        <div class="profile-actions">
          ${!profile.isDefault ? `
            <button class="btn btn-ghost btn-small edit-profile" data-id="${profile.id}">Edit</button>
            <button class="btn btn-ghost btn-small delete-profile" data-id="${profile.id}" style="color: var(--error);">Delete</button>
          ` : ''}
        </div>
      `;

            this.profilesList.appendChild(item);
        });

        // Add event listeners for edit/delete
        this.profilesList.querySelectorAll('.edit-profile').forEach(btn => {
            btn.addEventListener('click', () => this.editProfile(btn.dataset.id));
        });

        this.profilesList.querySelectorAll('.delete-profile').forEach(btn => {
            btn.addEventListener('click', () => this.deleteProfile(btn.dataset.id));
        });
    }

    editProfile(id) {
        const profile = this.profiles.find(p => p.id === id);
        if (!profile) return;

        this.editingProfile = profile;
        this.formTitle.textContent = 'Edit Profile';

        document.getElementById('profile-id').value = profile.id;
        document.getElementById('profile-name').value = profile.name;
        document.getElementById('profile-description').value = profile.description;

        // Render rules
        this.rulesList.innerHTML = '';
        (profile.rules || []).forEach(rule => this.addRuleInput(rule));

        // Add empty rule input if none exist
        if (!profile.rules || profile.rules.length === 0) {
            this.addRuleInput();
        }
    }

    async deleteProfile(id) {
        if (!confirm('Are you sure you want to delete this profile?')) return;

        try {
            await api.deleteProfile(id);
            this.profiles = this.profiles.filter(p => p.id !== id);
            this.renderProfiles();

            if (this.onSave) this.onSave();
        } catch (error) {
            alert('Failed to delete profile: ' + error.message);
        }
    }

    addRuleInput(value = '') {
        const ruleItem = document.createElement('div');
        ruleItem.className = 'rule-item';

        ruleItem.innerHTML = `
      <input type="text" class="rule-input" value="${value}" placeholder="Enter a translation rule...">
      <button class="btn btn-ghost btn-small remove-rule" style="color: var(--error);">×</button>
    `;

        ruleItem.querySelector('.remove-rule').addEventListener('click', () => {
            ruleItem.remove();
        });

        this.rulesList.appendChild(ruleItem);
    }

    async saveProfile() {
        const name = document.getElementById('profile-name').value.trim();
        const description = document.getElementById('profile-description').value.trim();
        const id = document.getElementById('profile-id').value || null;

        if (!name || !description) {
            alert('Please fill in both name and description');
            return;
        }

        const rules = Array.from(this.rulesList.querySelectorAll('.rule-input'))
            .map(input => input.value.trim())
            .filter(rule => rule.length > 0);

        try {
            await api.saveProfile({ id, name, description, rules });

            if (this.onSave) this.onSave();
            this.resetForm();

            // Refresh profiles list
            const profiles = await api.getProfiles();
            this.setProfiles(profiles);
            this.renderProfiles();

        } catch (error) {
            alert('Failed to save profile: ' + error.message);
        }
    }

    resetForm() {
        this.editingProfile = null;
        this.formTitle.textContent = 'Create New Profile';

        document.getElementById('profile-id').value = '';
        document.getElementById('profile-name').value = '';
        document.getElementById('profile-description').value = '';

        this.rulesList.innerHTML = '';
        this.addRuleInput();
    }
}
