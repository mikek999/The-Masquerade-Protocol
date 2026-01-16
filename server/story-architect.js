const axios = require('axios');

/**
 * StoryArchitect - Uses Google Gemini to generate structured Story Packets
 */
class StoryArchitect {
    constructor(apiKey) {
        this.apiKey = apiKey;
        this.apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${this.apiKey}`;
    }

    async generate(prompt, playerCount = 5) {
        const systemInstruction = `
            You are a Game Architect for "PlayerTXT".
            Output a PURE JSON story packet according to the following schema version 1.0.0.
            
            JSON Schema Reference:
            - version: "1.0.0"
            - metadata: { name, description, author, playerCount }
            - seed_data: { rooms: [], characters: [], items: [] }
            
            Rules:
            1. Characters MUST have a name, secretGoal, and personaPrompt.
            2. Rooms MUST have internalName, displayName, description, and exits.
            3. One character MUST be secretly designated as the antagonist in their secretGoal.
            4. At least one item MUST be a 'critical' clue.
            5. Return ONLY the JSON object. No markdown, no filler.
        `;

        const payload = {
            contents: [{
                parts: [{
                    text: `${systemInstruction}\n\nUser Concept: ${prompt}\nPlayer Count: ${playerCount}`
                }]
            }],
            generationConfig: {
                responseMimeType: "application/json"
            }
        };

        try {
            const response = await axios.post(this.apiUrl, payload);
            const content = response.data.candidates[0].content.parts[0].text;
            return JSON.parse(content);
        } catch (err) {
            console.error('Gemini Generation failed:', err.response?.data || err.message);
            throw new Error('Failed to generate story via Gemini');
        }
    }
}

module.exports = StoryArchitect;
