/**
 * AIOrchestrator - Dynamic AI Provider Manager
 * Manages two roles:
 * 1. DIRECTOR: High intelligence (Story, Adjudication)
 * 2. WORKHORSE: speed/Volume (NPCs, Descriptions)
 * 
 * Supported Providers: 'gemini', 'openrouter', 'ollama'
 * Uses NATIVE FETCH (No 3rd Party Libs)
 */
class AIOrchestrator {
    constructor(config = {}) {
        this.updateConfig(config);
    }

    updateConfig(config) {
        // Flat config map from DB
        this.config = config;

        this.director = {
            provider: config.AI_DIRECTOR_PROVIDER || 'gemini',
            key: config.AI_DIRECTOR_KEY || config.GEMINI_API_KEY,
            url: config.AI_DIRECTOR_URL,
            model: config.AI_DIRECTOR_MODEL || 'gemini-1.5-pro'
        };

        this.workhorse = {
            provider: config.AI_WORKHORSE_PROVIDER || 'ollama',
            key: config.AI_WORKHORSE_KEY || config.OPENROUTER_API_KEY,
            url: config.AI_WORKHORSE_URL || config.OLLAMA_URL || 'http://ollama:11434',
            model: config.AI_WORKHORSE_MODEL || 'llama3'
        };
    }

    // --- Role Based Calls ---

    async callDirector(prompt, systemInstruction = '') {
        return await this.routeRequest(this.director, prompt, systemInstruction);
    }

    async callWorkhorse(prompt, systemInstruction = '') {
        return await this.routeRequest(this.workhorse, prompt, systemInstruction);
    }

    // --- Verification & Routing ---

    async verifyProvider(role) {
        // role = 'director' or 'workhorse'
        const target = role === 'director' ? this.director : this.workhorse;
        try {
            const res = await this.routeRequest(target, 'Say "Verified"', 'System Check');
            return { success: true, message: res };
        } catch (e) {
            return { success: false, error: e.message };
        }
    }

    async routeRequest(target, prompt, systemInstruction) {
        switch (target.provider) {
            case 'gemini':
                return await this.callGemini(target, prompt, systemInstruction);
            case 'openrouter':
                return await this.callOpenRouter(target, prompt, systemInstruction);
            case 'ollama':
                return await this.callOllama(target, prompt, systemInstruction);
            default:
                throw new Error(`Unknown provider: ${target.provider}`);
        }
    }

    // --- Providers ---

    async callGemini(target, prompt, systemInstruction) {
        if (!target.key) throw new Error("Gemini Key Missing");
        // Convert model name if simplified
        const model = target.model.includes('/') ? target.model : `models/${target.model}`;
        const url = `https://generativelanguage.googleapis.com/v1beta/${model}:generateContent?key=${target.key}`;

        const payload = {
            contents: [{ parts: [{ text: `${systemInstruction}\n\n${prompt}` }] }]
        };

        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error?.message || res.statusText);
            }

            const data = await res.json();
            return data.candidates[0].content.parts[0].text;
        } catch (err) {
            console.error('Gemini Check Failed:', err.message);
            throw err;
        }
    }

    async callOpenRouter(target, prompt, systemInstruction) {
        if (!target.key) throw new Error("OpenRouter Key Missing");
        try {
            const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                method: 'POST',
                headers: {
                    "Authorization": `Bearer ${target.key}`,
                    "Content-Type": "application/json",
                    "HTTP-Referer": "https://playertxt.org",
                    "X-Title": "PlayerTXT"
                },
                body: JSON.stringify({
                    model: target.model,
                    messages: [
                        { role: "system", content: systemInstruction },
                        { role: "user", content: prompt }
                    ]
                })
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error?.message || res.statusText);
            }

            const data = await res.json();
            return data.choices[0].message.content;
        } catch (err) {
            throw err;
        }
    }

    async callOllama(target, prompt, systemInstruction) {
        const baseUrl = target.url.replace(/\/$/, ''); // Trim trailing slash
        try {
            const res = await fetch(`${baseUrl}/api/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: target.model,
                    prompt: `${systemInstruction}\n\n${prompt}`,
                    stream: false
                })
            });

            if (!res.ok) throw new Error(`Ollama Status: ${res.statusText}`);

            const data = await res.json();
            return data.response;
        } catch (err) {
            throw new Error(`Ollama Error: ${err.message}`);
        }
    }

    async fetchModels(provider, key, url) {
        try {
            if (provider === 'gemini') {
                const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
                if (!res.ok) throw new Error('Failed to fetch Gemini models');
                const data = await res.json();
                return data.models
                    .filter(m => m.supportedGenerationMethods.includes('generateContent'))
                    .map(m => m.name.replace('models/', ''));

            } else if (provider === 'openrouter') {
                const res = await fetch('https://openrouter.ai/api/v1/models');
                if (!res.ok) throw new Error('Failed to fetch OpenRouter models');
                const data = await res.json();
                return data.data.map(m => m.id);

            } else if (provider === 'ollama') {
                const baseUrl = (url || 'http://ollama:11434').replace(/\/$/, '');
                const res = await fetch(`${baseUrl}/api/tags`);
                if (!res.ok) throw new Error('Failed to fetch Ollama models');
                const data = await res.json();
                return data.models.map(m => m.name);
            }
        } catch (e) {
            throw new Error(`Fetch Models Failed: ${e.message}`);
        }
        return [];
    }

    /**
     * Embedding (Director Only for consistency)
     */
    async getEmbedding(text) {
        if (this.director.provider !== 'gemini') return null;
        const model = 'models/embedding-001';
        const url = `https://generativelanguage.googleapis.com/v1beta/${model}:embedContent?key=${this.director.key}`;
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model,
                    content: { parts: [{ text }] }
                })
            });
            if (!res.ok) return null;
            const data = await res.json();
            return data.embedding.values;
        } catch (err) { return null; }
    }
}

module.exports = AIOrchestrator;
