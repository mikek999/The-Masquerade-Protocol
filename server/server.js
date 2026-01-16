const express = require('express');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const morgan = require('morgan');
const cors = require('cors');
const sql = require('mssql');
require('dotenv').config();

const GameEngine = require('./game-logic');
const StoryInjestor = require('./story-injestor');
const ScenarioArchitect = require('./scenario-architect');
const AIOrchestrator = require('./ai-orchestrator');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 443;

// SQL Configuration
const dbConfig = {
    user: process.env.DB_USER || 'sa',
    password: process.env.DB_PASSWORD || 'YourStrong!Passw0rd',
    server: process.env.DB_SERVER || 'sqlserver',
    database: 'MasqueradeProtocol',
    options: {
        encrypt: false,
        trustServerCertificate: true
    }
};

// Initialize AI Orchestrator
const aiOrchestrator = new AIOrchestrator({
    geminiKey: process.env.GEMINI_API_KEY,
    openRouterKey: process.env.OPENROUTER_API_KEY,
    ollamaUrl: process.env.OLLAMA_URL
});

// Initialize Game Engine
const gameEngine = new GameEngine(dbConfig, aiOrchestrator);

// Middleware
app.use(helmet({
    contentSecurityPolicy: false, // Relax for admin dev
}));
app.use(morgan('dev'));
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());

// Serve Admin UI
app.use('/admin', express.static(path.join(__dirname, '../admin-ui')));

// Auth Middleware
async function authenticate(req, res, next) {
    const token = req.cookies.masquerade_session;
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    try {
        const pool = await sql.connect(dbConfig);
        const result = await pool.request()
            .input('token', sql.NVarChar, token)
            .query('SELECT * FROM Players WHERE SessionCookie = @token');

        if (result.recordset.length === 0) {
            return res.status(401).json({ error: 'Invalid session' });
        }

        req.player = result.recordset[0];
        next();
    } catch (err) {
        console.error('Auth error:', err);
        res.status(500).json({ error: 'Auth failed' });
    }
}

// Health Check
app.get('/health', (req, res) => {
    res.json({ status: 'active', timestamp: new Date() });
});

// Initial Login / Handshake
app.post('/api/v1/login', async (req, res) => {
    const { username } = req.body;

    if (!username) {
        return res.status(400).json({ error: 'Username is required' });
    }

    try {
        const pool = await sql.connect(dbConfig);

        // Find or create player
        let result = await pool.request()
            .input('username', sql.NVarChar, username)
            .query('SELECT * FROM Players WHERE Username = @username');

        let player = result.recordset[0];

        if (!player) {
            await pool.request()
                .input('username', sql.NVarChar, username)
                .query('INSERT INTO Players (Username) VALUES (@username)');

            result = await pool.request()
                .input('username', sql.NVarChar, username)
                .query('SELECT * FROM Players WHERE Username = @username');
            player = result.recordset[0];
        }

        const sessionToken = `player_${player.PlayerID}_${Date.now()}`;

        await pool.request()
            .input('playerId', sql.Int, player.PlayerID)
            .input('token', sql.NVarChar, sessionToken)
            .query('UPDATE Players SET SessionCookie = @token, LastSeen = GETDATE() WHERE PlayerID = @playerId');

        res.cookie('masquerade_session', sessionToken, {
            httpOnly: true,
            secure: false, // Set to true if using HTTPS in production
            sameSite: 'lax'
        });

        res.json({
            message: 'Logged in successfully',
            playerId: player.PlayerID,
            username: player.Username
        });

    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Database connection failed' });
    }
});

/**
 * Admin API Endpoints
 */

app.get('/api/v1/admin/stats', async (req, res) => {
    try {
        const pool = await sql.connect(dbConfig);
        const sessions = await pool.request().query('SELECT COUNT(*) as count FROM Sessions WHERE IsActive = 1');
        const players = await pool.request().query('SELECT COUNT(*) as count FROM Players WHERE LastSeen > DATEADD(minute, -10, GETDATE())');
        const aiChars = await pool.request().query('SELECT COUNT(*) as count FROM Characters WHERE IsAI = 1');

        res.json({
            activeSessions: sessions.recordset[0].count,
            onlinePlayers: players.recordset[0].count,
            aiAgents: aiChars.recordset[0].count
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/v1/admin/players', async (req, res) => {
    try {
        const pool = await sql.connect(dbConfig);
        const result = await pool.request().query(`
            SELECT p.PlayerID, p.Username, c.Name as CharacterName, r.DisplayName as RoomName, c.IsAI
            FROM Players p
            LEFT JOIN SessionPlayers sp ON p.PlayerID = sp.PlayerID
            LEFT JOIN Characters c ON sp.CharacterID = c.CharacterID
            LEFT JOIN Rooms r ON c.CurrentRoomID = r.RoomID
            WHERE p.LastSeen > DATEADD(hour, -1, GETDATE())
        `);
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/v1/admin/generate', async (req, res) => {
    const { prompt, playerCount } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) return res.status(500).json({ error: 'Gemini API Key missing' });
    if (!prompt) return res.status(400).json({ error: 'Prompt is required' });

    try {
        const architect = new ScenarioArchitect(apiKey);
        const storyJson = await architect.generate(prompt, playerCount);

        const injestor = new StoryInjestor(dbConfig);
        const worldId = await injestor.injest(storyJson);

        res.json({ success: true, worldId, storyName: storyJson.metadata.name });
    } catch (err) {
        console.error('Generation/Injest failure:', err);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/v1/state - Returns Zone A (World) and Zone C (Status)
app.get('/api/v1/state', authenticate, async (req, res) => {
    try {
        const state = await gameEngine.getPlayerState(req.player.PlayerID);
        res.json(state);
    } catch (err) {
        console.error('State error:', err);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/v1/comms - Returns Zone B (Radio/Global events)
app.get('/api/v1/comms', authenticate, async (req, res) => {
    res.json({
        zoneB: [
            { source: 'System', message: 'Welcome to The Masquerade Protocol.' }
        ]
    });
});

// POST /api/v1/action - Sends user commands to the engine
app.post('/api/v1/action', authenticate, async (req, res) => {
    const { command } = req.body;
    if (!command) return res.status(400).json({ error: 'Command is required' });

    try {
        const result = await gameEngine.processCommand(req.player.PlayerID, command);
        res.json(result);
    } catch (err) {
        console.error('Action error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Base Listen
app.listen(PORT, async () => {
    console.log(`The Masquerade Protocol Server running on port ${PORT}`);

    // Auto-ingest initial story if Worlds table is empty
    try {
        const pool = await sql.connect(dbConfig);
        const worlds = await pool.request().query('SELECT COUNT(*) as count FROM Worlds');

        if (worlds.recordset[0].count === 0) {
            console.log('No worlds found. Injesting initial scenario...');
            const injestor = new StoryInjestor(dbConfig);
            const storyPath = path.join(__dirname, '../scenarios/silent_submarine.json');

            if (fs.existsSync(storyPath)) {
                const storyData = JSON.parse(fs.readFileSync(storyPath, 'utf8'));
                await injestor.injest(storyData);
            } else {
                console.warn('Initial scenario file not found at:', storyPath);
            }
        }
    } catch (err) {
        console.error('Auto-ingest failed:', err);
    }
});
