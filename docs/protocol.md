# The PlayerTXT Protocol: Client Communication Standard

This document outlines the REST API for third-party client developers (retro computers, terminal emulators, etc.).

## Base Configuration
- **Port**: 80 (HTTP) or 443 (HTTPS)
- **Format**: JSON payloads
- **Auth**: Cookie-based (`playertxt_session`)

## Endpoints

### 1. Login
`POST /api/v1/login`
Initial handshake to obtain a session cookie.
**Request:**
```json
{ "username": "ATARI_USER_01" }
```
**Response:**
```json
{ "message": "Logged in successfully", "playerId": 1 }
```

### 2. Get Game State
`GET /api/v1/state`
Returns the visual data for Zone A (World) and Zone C (Status).
**Response:**
```json
{
  "systemStatus": "RUNNING", // WAITING, RUNNING, COMPLETED
  "missionTimer": 3540, // Seconds remaining (or seconds until start if WAITING)
  "zoneA": {
    "roomName": "Torpedo Room",
    "description": "The air is thick...",
    "items": [{"name": "Wrench"}],
    "exits": [{"direction": "NORTH"}]
  },
  "zoneC": {
    "characterName": "The Captain",
    "health": 100,
    "time": "01:22 AM"
  }
}
```

### System Status Definitions
- **WAITING**: The game has not started yet. Clients should display a countdown using `missionTimer`.
- **RUNNING**: The game is active. `missionTimer` indicates seconds remaining.
- **COMPLETED**: The game session has ended. Clients should show a summary or disconnect.
```

### 3. Get Communications
`GET /api/v1/comms`
Returns Zone B (Radio messages and global events).
**Response:**
```json
{
  "zoneB": [
    { "source": "Radio", "message": "All hands to battle stations!" }
  ]
}
```

### 4. Execute Action
`POST /api/v1/action`
Sends a text command to the engine.
**Request:**
```json
{ "command": "GO NORTH" }
```
**Response:**
```json
{ "message": "You squeeze through the bulkhead." }
```

## Protocol headers (Optional for Thin Clients)
Packet headers can be mapped to character-set translations on the client side (e.g., ASCII to PETSCII).
