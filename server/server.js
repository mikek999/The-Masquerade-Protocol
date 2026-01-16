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
const PORT = process.env.PORT || 80;

// Internal Log Buffer for Admin UI
const logBuffer = [];
const MAX_LOGS = 1000;

async function logToBuffer(message, level = 'INFO') {
    const logEntry = {
        timestamp: new Date().toISOString(),
        level,
        message
    };
    logBuffer.push(logEntry);
    if (logBuffer.length > MAX_LOGS) logBuffer.shift();
    console.log(`[${logEntry.level}] ${message}`);

    // Persist to SQL if connected
    try {
        const pool = await sql.connect(dbConfig);
        await pool.request()
            .input('level', sql.NVarChar, level)
            .input('message', sql.NVarChar, message)
            .query('INSERT INTO SystemLogs (Level, Message) VALUES (@level, @message)');
    } catch (err) {
        // Silently fail if DB not ready yet, it will be in the memory buffer anyway
    }
}

// SQL Configuration
const dbConfig = {
    user: process.env.DB_USER || 'sa',
    password: process.env.DB_PASSWORD || 'PlayerTXT2026!',
    server: process.env.DB_SERVER || 'sqlserver',
    database: 'PlayerTXT',
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

// Serve Admin UI with basic protection
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'PlayerTXT2026!';

// Admin Login Handler (must be before the auth check to avoid loops)
app.post('/admin/login', express.urlencoded({ extended: true }), (req, res) => {
    const { password } = req.body;
    if (password === ADMIN_PASSWORD) {
        res.cookie('admin_session', ADMIN_PASSWORD, { httpOnly: true });
        res.redirect('/admin/index.html');
    } else {
        res.status(403).send('ACCESS DENIED');
    }
});

app.use('/admin', (req, res, next) => {
    // 1. Check for valid session
    const auth = req.cookies.admin_session;
    if (auth === ADMIN_PASSWORD) {
        // If they just hit /admin, redirect to index.html to be sure
        if (req.path === '/' || req.path === '') {
            return res.redirect('/admin/index.html');
        }
        return next();
    }

    // 2. Allow access to login resources (if any external) - none currently

    // 3. For everything else under /admin, if not authenticated, show login
    // Only show login HTML for page requests, not for styles/js (which would error anyway)
    if (req.path === '/' || req.path === '' || req.path.endsWith('.html')) {
        return res.send(`
            <html>
            <head>
                <link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700&family=Outfit:wght@300;400;600&display=swap" rel="stylesheet">
                <style>
                    body {
                        background: radial-gradient(circle at center, #111, #000);
                        color: #fff;
                        font-family: 'Outfit', sans-serif;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        height: 100vh;
                        margin: 0;
                        overflow: hidden;
                    }
                    .login-card {
                        background: rgba(20, 20, 20, 0.8);
                        backdrop-filter: blur(20px);
                        border: 1px solid rgba(255, 255, 255, 0.1);
                        padding: 3rem;
                        border-radius: 20px;
                        text-align: center;
                        box-shadow: 0 20px 50px rgba(0,0,0,0.5);
                        max-width: 400px;
                        width: 90%;
                    }
                    .logo-box {
                        margin-bottom: 2rem;
                    }
                    .logo-box img {
                        width: 100px;
                        margin-bottom: 1rem;
                    }
                    h2 {
                        font-family: 'Orbitron', sans-serif;
                        font-size: 1.5rem;
                        letter-spacing: 3px;
                        margin-bottom: 0.5rem;
                        color: #00ff9d;
                    }
                    .slogan {
                        font-size: 0.9rem;
                        color: #888;
                        margin-bottom: 2rem;
                        display: block;
                    }
                    input {
                        width: 100%;
                        background: rgba(0,0,0,0.5);
                        border: 1px solid rgba(0, 255, 157, 0.3);
                        color: #00ff9d;
                        padding: 1rem;
                        margin-bottom: 1.5rem;
                        border-radius: 8px;
                        font-family: 'Space Mono', monospace;
                        text-align: center;
                        font-size: 1.1rem;
                        outline: none;
                        transition: border-color 0.3s;
                    }
                    input:focus {
                        border-color: #00ff9d;
                    }
                    button {
                        width: 100%;
                        background: #00ff9d;
                        color: #000;
                        border: none;
                        padding: 1rem;
                        font-family: 'Orbitron', sans-serif;
                        font-weight: bold;
                        border-radius: 8px;
                        cursor: pointer;
                        text-transform: uppercase;
                        letter-spacing: 2px;
                        transition: transform 0.2s;
                    }
                    button:hover {
                        transform: scale(1.05);
                    }
                    .version {
                        position: absolute;
                        bottom: 2rem;
                        font-size: 0.7rem;
                        color: #444;
                        font-family: monospace;
                    }
                </style>
            </head>
            <body>
                <div class="login-card">
                    <div class="logo-box">
                        <img src="/admin/logo.png" alt="PlayerTXT Logo">
                        <h2>PLAYER <span>TXT</span></h2>
                        <span class="slogan">Your Imagination, Powered by AI.</span>
                    </div>
                    <form method="POST" action="/admin/login">
                        <input type="password" name="password" placeholder="ACCESS_KEY" id="accessKey">
                        <button type="submit">ACCESS ENGINE</button>
                    </form>
                </div>
                <div class="version">PlayerTXT Game Engine v1.0.0 | Security Tier: EXTREME</div>
            </body>
            </html>
        `);
    }

    // For other assets (CSS/JS), if not authenticated, just 401
    res.status(401).send('Unauthorized');
});

app.use('/admin', express.static(path.join(__dirname, '../admin-ui')));

// Auth Middleware
async function authenticate(req, res, next) {
    const token = req.cookies.playertxt_session;
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
    res.json({ status: 'active', branding: 'PlayerTXT', timestamp: new Date() });
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

        res.cookie('playertxt_session', sessionToken, {
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
        logToBuffer(`Login failed for ${username}: ${err.message}`, 'ERROR');
        res.status(500).json({ error: 'Database connection failed' });
    }
});

/**
 * Admin API Endpoints
 */

app.get('/api/v1/admin/logs', async (req, res) => {
    // Check for admin session
    const auth = req.cookies.admin_session;
    if (auth !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        const pool = await sql.connect(dbConfig);
        const result = await pool.request()
            .query('SELECT TOP 100 Timestamp as timestamp, Level as level, Message as message FROM SystemLogs ORDER BY LogID DESC');

        // Return DB logs (reversed to show chronological order for UI) or fallback to buffer
        if (result.recordset.length > 0) {
            res.json(result.recordset.reverse());
        } else {
            res.json(logBuffer);
        }
    } catch (err) {
        res.json(logBuffer);
    }
});

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

    // Attempt to get from DB first
    let apiKey;
    try {
        const pool = await sql.connect(dbConfig);
        const configResult = await pool.request()
            .input('key', sql.NVarChar, 'GEMINI_API_KEY')
            .query('SELECT ConfigValue FROM SystemConfig WHERE ConfigKey = @key');
        apiKey = configResult.recordset[0]?.ConfigValue || process.env.GEMINI_API_KEY;
    } catch (e) {
        apiKey = process.env.GEMINI_API_KEY;
    }

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

app.get('/api/v1/admin/config', async (req, res) => {
    try {
        const pool = await sql.connect(dbConfig);
        const result = await pool.request().query('SELECT ConfigKey, ConfigValue FROM SystemConfig');
        const config = {};
        result.recordset.forEach(row => {
            config[row.ConfigKey] = row.ConfigValue;
        });
        res.json(config);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/v1/admin/config', async (req, res) => {
    const configs = req.body;
    try {
        const pool = await sql.connect(dbConfig);
        for (const [key, value] of Object.entries(configs)) {
            await pool.request()
                .input('key', sql.NVarChar, key)
                .input('val', sql.NVarChar, value)
                .query(`
                    IF EXISTS (SELECT 1 FROM SystemConfig WHERE ConfigKey = @key)
                        UPDATE SystemConfig SET ConfigValue = @val, UpdatedAt = GETDATE() WHERE ConfigKey = @key
                    ELSE
                        INSERT INTO SystemConfig (Category, ConfigKey, ConfigValue) VALUES ('AI_MODELS', @key, @val)
                `);
        }

        // Refresh Orchestrator Config
        aiOrchestrator.updateConfig(configs);

        res.json({ success: true });
    } catch (err) {
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
            { source: 'System', message: 'Welcome to the PlayerTXT Protocol.' }
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
    logToBuffer(`PlayerTXT Protocol Engine online on port ${PORT}`);

    // Auto-bootstrap / Retry Logic
    let connected = false;
    let retries = 0;
    const maxRetries = 10;

    while (!connected && retries < maxRetries) {
        try {
            const pool = await sql.connect(dbConfig);
            logToBuffer('Connected to SQL Cluster.');

            // Auto-ingest initial story if Worlds table is empty
            const worlds = await pool.request().query('SELECT COUNT(*) as count FROM Worlds');

            if (worlds.recordset[0].count === 0) {
                logToBuffer('No worlds found. Injesting initial scenario...');
                const injestor = new StoryInjestor(dbConfig);
                const storyPath = path.join(__dirname, '../scenarios/silent_submarine.json');

                if (fs.existsSync(storyPath)) {
                    const storyData = JSON.parse(fs.readFileSync(storyPath, 'utf8'));
                    await injestor.injest(storyData);
                } else {
                    console.warn('Initial scenario file not found at:', storyPath);
                }
            }

            // Load AI Config from SystemConfig table
            const configResult = await pool.request().query('SELECT ConfigKey, ConfigValue FROM SystemConfig');
            const dbConfigMap = {};
            configResult.recordset.forEach(row => {
                dbConfigMap[row.ConfigKey] = row.ConfigValue;
            });
            aiOrchestrator.updateConfig(dbConfigMap);
            logToBuffer('AI Orchestrator re-indexed with Dynamic Configuration.');

            connected = true;
            logToBuffer('PlayerTXT Protocol Engine fully synchronized.');

        } catch (err) {
            retries++;
            logToBuffer(`Database connection attempt ${retries}/${maxRetries} failed: ${err.message}`, 'WARN');
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }

    if (!connected) {
        logToBuffer('CRITICAL: Failed to connect to database after multiple attempts. Engine remains in degraded state.', 'ERROR');
    }
});
