const axios = require('axios');

/**
 * AIOrchestrator - Unified interface for tiered AI models
 * Supports: Local Ollama, OpenRouter (Cheap cloud), and Google Gemini (Director)
 */
class AIOrchestrator {
    constructor(config = {}) {
        this.updateConfig(config);
    }

    updateConfig(config) {
        this.geminiKey = config.GEMINI_API_KEY || config.geminiKey;
        this.openRouterKey = config.OPENROUTER_API_KEY || config.openRouterKey;
        this.ollamaUrl = config.OLLAMA_URL || config.ollamaUrl || 'http://localhost:11434';
        this.workhorsePref = config.WORKHORSE_PREF || 'ollama';
    }

    /**
     * Call a Tier 2 "Workhorse" model (Ollama or OpenRouter)
     */
    async callWorkhorse(prompt, systemInstruction = '') {
        if (this.workhorsePref === 'openrouter' && this.openRouterKey) {
            return await this.callOpenRouter(prompt, systemInstruction, "meta-llama/llama-3-8b-instruct:free");
        } else {
            return await this.callOllama(prompt, systemInstruction, "llama3");
        }
    }

    /**
     * Call the Tier 3 "Director" model (Google Gemini)
     */
    async callDirector(prompt, systemInstruction = '') {
        if (!this.geminiKey) throw new Error("Gemini API Key required for Director tasks");

        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${this.geminiKey}`;
        const payload = {
            contents: [{ parts: [{ text: `${systemInstruction}\n\n${prompt}` }] }]
        };

        try {
            const response = await axios.post(url, payload);
            return response.data.candidates[0].content.parts[0].text;
        } catch (err) {
            console.error('Gemini Director failed:', err.response?.data || err.message);
            throw err;
        }
    }

    async callOpenRouter(prompt, systemInstruction, model) {
        try {
            const response = await axios.post("https://openrouter.ai/api/v1/chat/completions", {
                model: model,
                messages: [
                    { role: "system", content: systemInstruction },
                    { role: "user", content: prompt }
                ]
            }, {
                headers: {
                    "Authorization": `Bearer ${this.openRouterKey}`,
                    "HTTP-Referer": "https://github.com/mikek999/The-Masquerade-Protocol",
                    "X-Title": "The Masquerade Protocol"
                }
            });
            return response.data.choices[0].message.content;
        } catch (err) {
            console.error('OpenRouter failed:', err.response?.data || err.message);
            throw err;
        }
    }

    async callOllama(prompt, systemInstruction, model) {
        try {
            const response = await axios.post(`${this.ollamaUrl}/api/generate`, {
                model: model,
                prompt: `${systemInstruction}\n\n${prompt}`,
                stream: false
            });
            return response.data.response;
        } catch (err) {
            console.error('Ollama failed:', err.message);
            // Fallback to error message or mock for local dev if ollama isn't running
            return "Local AI (Ollama) is offline.";
        }
    }

    /**
     * Embed text for SQL Server 2025 Vector search
     */
    async getEmbedding(text) {
        if (!this.geminiKey) return null;
        const url = `https://generativelanguage.googleapis.com/v1beta/models/embedding-001:embedContent?key=${this.geminiKey}`;
        try {
            const response = await axios.post(url, {
                model: "models/embedding-001",
                content: { parts: [{ text }] }
            });
            return response.data.embedding.values;
        } catch (err) {
            console.error('Embedding failed:', err.message);
            return null;
        }
    }
}

module.exports = AIOrchestrator;
