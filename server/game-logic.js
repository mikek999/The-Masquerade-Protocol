const sql = require('mssql');

/**
 * GameEngine - Core logic for The PlayerTXT Protocol
 */
class GameEngine {
    constructor(dbConfig, aiOrchestrator) {
        this.dbConfig = dbConfig;
        this.ai = aiOrchestrator;
        this.pool = null;
    }

    async connect() {
        if (!this.pool) {
            this.pool = await sql.connect(this.dbConfig);
        }
        return this.pool;
    }

    /**
     * Get the current state for a player (Zone A and Zone C)
     */
    async getPlayerState(playerId) {
        const pool = await this.connect();

        // 1. Get Character and Room info
        const result = await pool.request()
            .input('playerId', sql.Int, playerId)
            .query(`
                SELECT c.CharacterID, c.Name, r.RoomID, r.DisplayName, r.BaseDescription, r.IsDark
                FROM SessionPlayers sp
                JOIN Characters c ON sp.CharacterID = c.CharacterID
                JOIN Rooms r ON c.CurrentRoomID = r.RoomID
                WHERE sp.PlayerID = @playerId
            `);

        const state = result.recordset[0];
        if (!state) return { error: 'No active session or character found' };

        // 2. Get Visible Items in the room
        const itemsResult = await pool.request()
            .input('roomId', sql.Int, state.RoomID)
            .query('SELECT Name, Description FROM Items WHERE CurrentRoomID = @roomId AND IsHidden = 0');

        // 3. Get Exits from the room
        const exitsResult = await pool.request()
            .input('roomId', sql.Int, state.RoomID)
            .query('SELECT Direction, Description FROM Exits WHERE SourceRoomID = @roomId');

        return {
            zoneA: {
                roomName: state.DisplayName,
                description: state.BaseDescription,
                isDark: state.IsDark,
                items: itemsResult.recordset,
                exits: exitsResult.recordset
            },
            zoneC: {
                characterName: state.Name,
                health: 100, // Placeholder
                time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            }
        };
    }

    /**
     * Process a command from a player
     */
    async processCommand(playerId, command) {
        const pool = await this.connect();
        const cmd = command.trim().toUpperCase();

        // This is a simplified "Reflex" parser for movement
        if (['NORTH', 'SOUTH', 'EAST', 'WEST', 'UP', 'DOWN', 'N', 'S', 'E', 'W', 'U', 'D'].includes(cmd)) {
            return await this.movePlayer(playerId, cmd);
        }

        // Otherwise, send to the MCP / AI layer (to be implemented)
        return {
            message: `You typed: "${command}". The AI layer will process this shortly.`,
            actionRequired: 'llm_process'
        };
    }

    /**
     * Get relevant facts about the room/items using SQL 2025 Vector search
     */
    async getSemanticFacts(sessionId, query) {
        if (!this.ai) return [];

        const embedding = await this.ai.getEmbedding(query);
        if (!embedding) return [];

        const pool = await this.connect();
        try {
            // Using SQL 2025 Vector search syntax (VECTOR_DISTANCE)
            // Note: This is an idealized query based on SQL 2025 preview docs
            const result = await pool.request()
                .input('sessionId', sql.Int, sessionId)
                .input('vector', sql.NVarChar, JSON.stringify(embedding))
                .query(`
                    SELECT TOP 5 Attribute, Value, 
                           VECTOR_DISTANCE(FactVector, CAST(@vector AS VECTOR(1536))) as Distance
                    FROM WorldFacts
                    WHERE SessionID = @sessionId
                    ORDER BY Distance ASC
                `);

            return result.recordset;
        } catch (err) {
            console.error('Vector search failed (requires SQL Server 2025):', err.message);
            return [];
        }
    }

    async movePlayer(playerId, direction) {
        const pool = await this.connect();
        const dirMap = { 'N': 'NORTH', 'S': 'SOUTH', 'E': 'EAST', 'W': 'WEST', 'U': 'UP', 'D': 'DOWN' };
        const fullDir = dirMap[direction] || direction;

        // 1. Find the exit
        const exitResult = await pool.request()
            .input('playerId', sql.Int, playerId)
            .input('direction', sql.NVarChar, fullDir)
            .query(`
                SELECT e.DestRoomID, e.Description
                FROM SessionPlayers sp
                JOIN Characters c ON sp.CharacterID = c.CharacterID
                JOIN Exits e ON c.CurrentRoomID = e.SourceRoomID
                WHERE sp.PlayerID = @playerId AND e.Direction = @direction
            `);

        const exit = exitResult.recordset[0];
        if (!exit) {
            return { message: "You can't go that way." };
        }

        // 2. Update character location
        await pool.request()
            .input('playerId', sql.Int, playerId)
            .input('destRoomId', sql.Int, exit.DestRoomID)
            .query(`
                UPDATE Characters 
                SET CurrentRoomID = @destRoomId 
                FROM Characters c
                JOIN SessionPlayers sp ON c.CharacterID = sp.CharacterID
                WHERE sp.PlayerID = @playerId
            `);

        // 3. Log the event
        // (Log implementation to be added)

        return {
            message: exit.Description || `You move ${fullDir.toLowerCase()}.`,
            newRoomId: exit.DestRoomID
        };
    }
    /**
     * Understudy System - Process AI Character actions
     */
    async processAITurns(sessionId) {
        // To be implemented: LLM-driven actions for NPCs and Understudies
        console.log(`Processing AI turns for session ${sessionId}`);
    }
}

module.exports = GameEngine;
