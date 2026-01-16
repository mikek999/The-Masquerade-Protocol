const express = require('express');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const morgan = require('morgan');
const cors = require('cors');
const sql = require('mssql');
const os = require('os');
require('dotenv').config();

const GameEngine = require('./game-logic');
const StoryInjestor = require('./story-injestor');
const StoryArchitect = require('./story-architect');
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
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    OLLAMA_URL: process.env.OLLAMA_URL
});
global.aiOrchestrator = aiOrchestrator; // Expose for Status API & PreFlight Checks

// Initialize Game Engine
// Initialize Game Engine
const gameEngine = new GameEngine(dbConfig, aiOrchestrator);

// --- Pre-flight Checks ---
const PreFlightChecks = {
    sql: false,
    llm: false,
    lastCheck: null,

    run: async () => {
        // 1. SQL
        try {
            const pool = await sql.connect(dbConfig);
            PreFlightChecks.sql = true;
        } catch { PreFlightChecks.sql = false; }

        // 2. LLM (Enhanced)
        if (global.aiOrchestrator) {
            try {
                // Verify Workhorse
                const whCheck = await global.aiOrchestrator.verifyProvider('workhorse');
                if (whCheck.success) {
                    logToBuffer(`AI Workhorse (${global.aiOrchestrator.workhorse.provider}): ONLINE`, 'INFO');
                } else {
                    logToBuffer(`AI Workhorse (${global.aiOrchestrator.workhorse.provider}): OFFLINE - ${whCheck.error}`, 'WARN');
                }

                // Verify Director
                const dirCheck = await global.aiOrchestrator.verifyProvider('director');
                if (dirCheck.success) {
                    logToBuffer(`AI Director (${global.aiOrchestrator.director.provider}): ONLINE`, 'INFO');
                } else {
                    logToBuffer(`AI Director (${global.aiOrchestrator.director.provider}): OFFLINE - ${dirCheck.error}`, 'WARN');
                }

                // Strict: LLM is OK if Workhorse is OK (Director might be optional/cloud)
                // But for now let's set it based on Workhorse connectivity as the baseline
                PreFlightChecks.llm = whCheck.success;
            } catch (e) {
                console.error(e);
                PreFlightChecks.llm = false;
            }
        }
        PreFlightChecks.lastCheck = new Date();

        const overall = PreFlightChecks.sql && PreFlightChecks.llm ? 'ONLINE' : 'DEGRADED';
        if (global.SERVER_MODE !== overall) {
            global.SERVER_MODE = overall;
            logToBuffer(`System Status Change: ${overall}`, overall === 'ONLINE' ? 'INFO' : 'WARN');
        }
    }
};

// Run check periodically
setInterval(PreFlightChecks.run, 30000);
PreFlightChecks.run(); // Initial check

// --- Game Session Scheduler ---
const GameScheduler = {
    status: 'WAITING', // WAITING, RUNNING, COMPLETED
    timer: 0,
    sessionId: null,
    worldId: null,
    startTime: null,
    endTime: null,
    interval: null,

    startTickLoop: () => {
        if (GameScheduler.interval) clearInterval(GameScheduler.interval);
        GameScheduler.interval = setInterval(async () => {
            const now = new Date();

            if (GameScheduler.status === 'WAITING' && GameScheduler.startTime) {
                const diff = (GameScheduler.startTime - now) / 1000;
                GameScheduler.timer = Math.floor(diff);

                if (diff <= 0) {
                    await GameScheduler.activateSession();
                }
            } else if (GameScheduler.status === 'RUNNING' && GameScheduler.endTime) {
                const diff = (GameScheduler.endTime - now) / 1000;
                GameScheduler.timer = Math.floor(diff);

                if (diff <= 0) {
                    await GameScheduler.completeSession();
                }
            }
        }, 1000);
    },

    activateSession: async () => {
        console.log('[SCHEDULER] Activating Session...');
        GameScheduler.status = 'RUNNING';
        try {
            const pool = await sql.connect(dbConfig);
            // Create Session Row
            const res = await pool.request()
                .input('wid', sql.Int, GameScheduler.worldId)
                .query(`INSERT INTO Sessions (WorldID, StartTime, IsActive) OUTPUT INSERTED.SessionID VALUES (@wid, GETDATE(), 1)`);

            GameScheduler.sessionId = res.recordset[0].SessionID;
            console.log(`[SCHEDULER] Session ${GameScheduler.sessionId} Started.`);
            logToBuffer(`Session ${GameScheduler.sessionId} Started`, 'INFO');
        } catch (e) {
            console.error('[SCHEDULER] Start Failed', e);
            logToBuffer(`Session Start Failed: ${e.message}`, 'ERROR');
        }
    },

    completeSession: async () => {
        console.log('[SCHEDULER] Completing Session...');
        GameScheduler.status = 'COMPLETED';
        GameScheduler.timer = 0;
        try {
            const pool = await sql.connect(dbConfig);
            if (GameScheduler.sessionId) {
                await pool.request()
                    .input('sid', sql.Int, GameScheduler.sessionId)
                    .query(`UPDATE Sessions SET IsActive = 0, EndTime = GETDATE() WHERE SessionID = @sid`);
            }
            logToBuffer(`Session ${GameScheduler.sessionId || '?'} Completed`, 'INFO');
        } catch (e) {
            console.error('[SCHEDULER] End Failed', e);
        }
    }
};

GameScheduler.startTickLoop(); // Start on boot

// ------------------------------

// Middleware
app.use(helmet({
    contentSecurityPolicy: false, // Relax for admin dev
}));
app.use(morgan('dev'));
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());

// Serve Admin UI with basic protection
// Serve Admin UI with basic protection
// Load dynamic config from global if set, else env
global.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'PlayerTXT2026!';
global.SERVER_MODE = 'ONLINE';

// Admin Login Handler (must be before the auth check to avoid loops)
app.post('/admin/login', express.urlencoded({ extended: true }), (req, res) => {
    const { password } = req.body;

    // Refresh ADMIN_PASSWORD from config in case it changed
    if (password === (global.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || 'PlayerTXT2026!')) {
        res.cookie('admin_session', global.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || 'PlayerTXT2026!', { httpOnly: true });
        res.redirect('/admin/index.html');
    } else {
        res.status(403).send('ACCESS DENIED');
    }
});

app.all('/admin/logout', (req, res) => {
    res.clearCookie('admin_session');
    res.redirect('/admin/index.html');
});

app.use('/admin', (req, res, next) => {
    // 1. Check for valid session
    const auth = req.cookies.admin_session;
    // Check against global dynamic password
    const currentPass = global.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || 'PlayerTXT2026!';

    if (auth === currentPass) {
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

    // Check Server Mode
    if (global.SERVER_MODE === 'OFFLINE') {
        return res.status(503).json({ error: 'Server is currently OFFLINE (Maintenance Mode)' });
    }

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
        const architect = new StoryArchitect(apiKey);
        const storyJson = await architect.generate(prompt, playerCount);

        const injestor = new StoryInjestor(dbConfig);
        const worldId = await injestor.injest(storyJson);

        res.json({ success: true, worldId, storyName: storyJson.metadata.name });
    } catch (err) {
        console.error('Generation/Injest failure:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/v1/admin/password', async (req, res) => {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 8) return res.status(400).json({ error: 'Password too short' });

    try {
        const pool = await sql.connect(dbConfig);
        await pool.request()
            .input('val', sql.NVarChar, newPassword)
            .query(`
                IF EXISTS (SELECT 1 FROM SystemConfig WHERE ConfigKey = 'ADMIN_PASSWORD')
                    UPDATE SystemConfig SET ConfigValue = @val, UpdatedAt = GETDATE() WHERE ConfigKey = 'ADMIN_PASSWORD'
                ELSE
                    INSERT INTO SystemConfig (Category, ConfigKey, ConfigValue, IsSecret) VALUES ('AUTH', 'ADMIN_PASSWORD', @val, 1)
            `);

        global.ADMIN_PASSWORD = newPassword;
        res.json({ success: true, message: 'Admin password updated. Please re-login.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/v1/admin/server-mode', async (req, res) => {
    const { mode } = req.body; // ONLINE / OFFLINE
    if (!['ONLINE', 'OFFLINE'].includes(mode)) return res.status(400).json({ error: 'Invalid mode' });

    try {
        const pool = await sql.connect(dbConfig);
        await pool.request()
            .input('val', sql.NVarChar, mode)
            .query(`
                IF EXISTS (SELECT 1 FROM SystemConfig WHERE ConfigKey = 'SERVER_MODE')
                    UPDATE SystemConfig SET ConfigValue = @val, UpdatedAt = GETDATE() WHERE ConfigKey = 'SERVER_MODE'
                ELSE
                    INSERT INTO SystemConfig (Category, ConfigKey, ConfigValue) VALUES ('SYSTEM', 'SERVER_MODE', @val)
            `);

        res.json({ success: true, mode });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/v1/admin/status', async (req, res) => {
    // AI Checks
    let aiStatus = {
        director: { status: 'UNKNOWN', model: 'N/A' },
        workhorse: { status: 'UNKNOWN', model: 'N/A' }
    };
    let dbStatus = 'OFFLINE'; // Initialize dbStatus

    try {
        const pool = await sql.connect(dbConfig);
        await pool.request().query('SELECT 1');
        dbStatus = 'ONLINE';
    } catch (e) { /* ignore */ }

    // Check AI details if orchestrator loaded
    if (global.aiOrchestrator) {
        aiStatus.director.model = global.aiOrchestrator.director?.model || 'N/A';
        aiStatus.workhorse.model = global.aiOrchestrator.workhorse?.model || 'N/A';

        // We use the cached check result or verify? 
        // For /status, we return the LAST KNOWN check result to be fast
        if (PreFlightChecks.llm) {
            aiStatus.director.status = 'ONLINE'; // Simplified for now, real check is async
            aiStatus.workhorse.status = 'ONLINE';
        } else {
            aiStatus.director.status = 'CHECKING/FAULT';
            aiStatus.workhorse.status = 'CHECKING/FAULT';
        }
    }

    // Get IP
    const nets = os.networkInterfaces();
    let serverIp = 'localhost';
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            if (net.family === 'IPv4' && !net.internal) {
                serverIp = net.address;
                break;
            }
        }
    }

    // Format URL (hide port if standard)
    let urlPort = PORT == 80 || PORT == 443 ? '' : `:${PORT}`;

    res.json({
        dbStatus,
        aiStatus,
        serverMode: global.SERVER_MODE || 'ONLINE',
        ip: serverIp + urlPort,
        checks: PreFlightChecks
    });
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

// AI: Fetch Models
app.post('/api/v1/admin/ai/models', async (req, res) => {
    const { provider, key, url } = req.body;
    try {
        const models = await aiOrchestrator.fetchModels(provider, key, url);
        res.json(models);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// AI: Verify Configuration
app.post('/api/v1/admin/ai/verify', async (req, res) => {
    const { role } = req.body; // 'director' or 'workhorse'

    // Create a temporary orchestrator with the submitted config to test BEFORE saving
    // Or, if saving first, just verify against current config. 
    // The requirement implies verifying the *selected* model, which might not be saved yet.
    // Let's assume we pass the full config to verify?
    // Actually simplicity: Update config first, then verify.
    // OR: Temporarily update orchestrator for this request? 

    // Better path: The Orchestrator verification method verifies CURRENT config.
    // UI should Save -> Then Verify.

    try {
        const result = await aiOrchestrator.verifyProvider(role);
        if (result.success) {
            res.json({ success: true, message: result.message });
        } else {
            res.status(400).json({ success: false, error: result.error });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- Admin: Mission Control APIs ---

// List Available Stories
app.get('/api/v1/admin/stories', async (req, res) => {
    try {
        const pool = await sql.connect(dbConfig);
        const result = await pool.request().query('SELECT WorldID, Name, Description FROM Worlds ORDER BY CreatedAt DESC');
        res.json(result.recordset);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Schedule/Start Game
app.post('/api/v1/admin/game/schedule', async (req, res) => {
    // 1. Enforce Pre-flight
    if (!PreFlightChecks.sql || !PreFlightChecks.llm) {
        return res.status(503).json({ error: 'System Pre-flight Checks Failed. Cannot start mission.' });
    }

    // 2. Enforce Single Session
    if (GameScheduler.status === 'RUNNING' || GameScheduler.status === 'WAITING') {
        return res.status(409).json({ error: 'Mission already in progress. Abort current mission first.' });
    }

    const { worldId, startTime, durationMinutes } = req.body;
    // startTime is ISO string. If null/undefined, start NOW.

    if (!worldId) return res.status(400).json({ error: 'World ID required' });

    try {
        const start = startTime ? new Date(startTime) : new Date();
        const duration = (durationMinutes || 30) * 60000; // minutes to ms
        const end = new Date(start.getTime() + duration);

        GameScheduler.worldId = worldId;
        GameScheduler.startTime = start;
        GameScheduler.endTime = end;
        GameScheduler.status = 'WAITING'; // Process loop will pick it up

        logToBuffer(`Mission Scheduled: World ${worldId} at ${start.toLocaleTimeString()}`, 'INFO');
        res.json({ success: true, message: 'Mission Scheduled' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Stop/Abort Game
app.post('/api/v1/admin/game/stop', async (req, res) => {
    if (GameScheduler.status === 'IDLE' || GameScheduler.status === 'COMPLETED') {
        return res.status(400).json({ error: 'No active mission to abort.' });
    }

    await GameScheduler.completeSession();
    // Force status to completed immediately if scheduler loop is slow
    GameScheduler.status = 'COMPLETED';

    logToBuffer('Mission Aborted by Admin', 'WARN');
    res.json({ success: true, message: 'Mission Aborted' });
});

app.get('/api/v1/admin/game/status', (req, res) => {
    res.json({
        status: GameScheduler.status,
        timer: GameScheduler.timer,
        worldId: GameScheduler.worldId,
        startTime: GameScheduler.startTime,
        sessionId: GameScheduler.sessionId,
        checks: {
            sql: PreFlightChecks.sql,
            llm: PreFlightChecks.llm
        }
    });
});

// -----------------------------------

// GET /api/v1/state - Returns Zone A (World) and Zone C (Status)
app.get('/api/v1/state', authenticate, async (req, res) => {
    try {
        const state = await gameEngine.getPlayerState(req.player.PlayerID);
        // Inject Scheduler State
        state.systemStatus = GameScheduler.status;
        state.missionTimer = GameScheduler.timer;
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

            // CLEAR LOGS ON BOOT (Fresh Start)
            await pool.request().query('DELETE FROM SystemLogs');
            logToBuffer('System Logs cleared for fresh boot.', 'INFO');

            // Auto-ingest initial story if Worlds table is empty
            const worlds = await pool.request().query('SELECT COUNT(*) as count FROM Worlds');

            if (worlds.recordset[0].count === 0) {
                logToBuffer('No worlds found. Injesting initial story...');
                const injestor = new StoryInjestor(dbConfig);
                const storyPath = path.join(__dirname, '../stories/silent_submarine.json');

                if (fs.existsSync(storyPath)) {
                    const storyData = JSON.parse(fs.readFileSync(storyPath, 'utf8'));
                    await injestor.injest(storyData);
                } else {
                    console.warn('Initial story file not found at:', storyPath);
                }
            }

            // Load System Configs (Passwords, Modes)
            const sysConfig = await pool.request().query('SELECT ConfigKey, ConfigValue FROM SystemConfig');
            sysConfig.recordset.forEach(row => {
                if (row.ConfigKey === 'ADMIN_PASSWORD') global.ADMIN_PASSWORD = row.ConfigValue;
                if (row.ConfigKey === 'SERVER_MODE') global.SERVER_MODE = row.ConfigValue;
            });

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
