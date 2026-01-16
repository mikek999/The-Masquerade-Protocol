document.addEventListener('DOMContentLoaded', async () => {
    let GAME_SERVER_URL = '';
    let SESSION_ID = null; // Stored in cookie by browser, but we track logic state

    // UI Elements
    const loginScreen = document.getElementById('login-screen');
    const gameScreen = document.getElementById('game-screen');
    const statusDiv = document.getElementById('login-status');

    // Fetch Config
    try {
        const res = await fetch('/config');
        const config = await res.json();
        GAME_SERVER_URL = config.gameServerUrl;
        console.log('Target Game Server:', GAME_SERVER_URL);
    } catch (e) {
        statusDiv.innerText = 'Failed to load client config.';
        return;
    }

    // Login Logic
    document.getElementById('loginBtn').addEventListener('click', doLogin);
    document.getElementById('username').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') doLogin();
    });

    async function doLogin() {
        const username = document.getElementById('username').value.trim();
        if (!username) return;

        try {
            statusDiv.innerText = 'Connecting...';
            const res = await fetch(`${GAME_SERVER_URL}/api/v1/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username })
            });

            if (res.ok) {
                const data = await res.json();
                console.log('Login Success:', data);
                // Switch Screens
                loginScreen.classList.remove('active');
                gameScreen.classList.add('active');
                document.getElementById('player-status').innerText = `OPERATOR: ${username}`;

                // Start Loop
                startPolling();
                document.getElementById('cmdInput').focus();
            } else {
                const err = await res.json();
                statusDiv.innerText = err.error || 'Connection Refused';
            }
        } catch (e) {
            console.error(e);
            statusDiv.innerText = 'Network Error: Check Console';
        }
    }

    // Game Loop
    let lastComms = [];
    let pollingInterval = null;

    async function startPolling() {
        if (pollingInterval) clearInterval(pollingInterval);
        pollingInterval = setInterval(async () => {
            const state = await fetchState();
            await fetchComms();

            // Handle Global Game States
            if (state && state.systemStatus === 'WAITING') {
                showOverlay(`MISSION STANDBY<br>T-MINUS ${state.missionTimer} SECONDS`);
            } else if (state && state.systemStatus === 'COMPLETED') {
                showOverlay('MISSION COMPLETE<br>CONNECTION TERMINATED');
            } else {
                hideOverlay();
            }

        }, 2000); // 2s Tick

        await fetchState(); // Initial
    }

    // Helper for Wait/End Screens
    function showOverlay(html) {
        let ov = document.getElementById('status-overlay');
        if (!ov) {
            ov = document.createElement('div');
            ov.id = 'status-overlay';
            ov.style = 'position:absolute;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.9);color:lime;display:flex;align-items:center;justify-content:center;text-align:center;font-size:2em;z-index:999;border:4px solid lime;';
            document.body.appendChild(ov);
        }
        ov.innerHTML = html;
        ov.style.display = 'flex';
    }

    function hideOverlay() {
        const ov = document.getElementById('status-overlay');
        if (ov) ov.style.display = 'none';
    }

    async function fetchState() {
        try {
            // Include credentials to send the cookie
            const res = await fetch(`${GAME_SERVER_URL}/api/v1/state`, {
                credentials: 'include'
            });
            if (res.ok) {
                const data = await res.json();
                renderZoneA(data.zoneA);
                renderZoneC(data.zoneC);
                return data; // Return full state for loop to check systemStatus
            }
        } catch (e) { console.warn('State fetch failed', e); }
    }

    async function fetchComms() {
        try {
            const res = await fetch(`${GAME_SERVER_URL}/api/v1/comms`, {
                credentials: 'include'
            });
            if (res.ok) {
                const data = await res.json();
                renderZoneB(data.zoneB);
            }
        } catch (e) { console.warn('Comms fetch failed', e); }
    }

    // Action Logic
    document.getElementById('sendBtn').addEventListener('click', sendCommand);
    document.getElementById('cmdInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendCommand();
    });

    async function sendCommand() {
        const input = document.getElementById('cmdInput');
        const cmd = input.value.trim();
        if (!cmd) return;

        // Optimistic UI update
        const zoneA = document.getElementById('zone-a');
        zoneA.innerHTML += `<p style="color: #888;">&gt; ${cmd}</p>`;
        zoneA.scrollTop = zoneA.scrollHeight;
        input.value = '';

        try {
            const res = await fetch(`${GAME_SERVER_URL}/api/v1/action`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ command: cmd })
            });
            const data = await res.json();

            // Server response usually appears in next state update or immediately like this:
            if (data.message) {
                zoneA.innerHTML += `<p>${data.message}</p>`;
                zoneA.scrollTop = zoneA.scrollHeight;
            }
        } catch (e) {
            zoneA.innerHTML += `<p style="color: red;">ERR: TX FAILED</p>`;
        }
    }

    // Render Helpers
    function renderZoneA(data) {
        if (!data) return;
        const zoneA = document.getElementById('zone-a');
        // Simple render: Update description if changed, or just append messages
        // For this reference client, we'll just display the current room info fixed at top
        // and let the history scroll below? Or just simple Text Adventure style.

        // Let's go with Room Info + Inventory
        let html = `<h2>${data.roomName || 'UNKNOWN LOCATION'}</h2>`;
        html += `<p>${data.description || ''}</p>`;

        if (data.items && data.items.length > 0) {
            html += `<p>VISIBLE: ${data.items.map(i => i.name).join(', ')}</p>`;
        }
        if (data.exits && data.exits.length > 0) {
            html += `<p>EXITS: ${data.exits.map(e => e.direction).join(' | ')}</p>`;
        }

        // NOTE: In a real client, we'd manage a scrollback buffer. 
        // For this simple thin client, we are refreshing the "View".
        // To preserve history, we'd need more complex logic. 
        // For now, let's keep it simple: State View (Current Status).
        zoneA.innerHTML = html;
    }

    function renderZoneC(data) {
        if (!data) return;
        document.getElementById('game-time').innerText = data.time || '--:--';

        const content = document.getElementById('status-content');
        content.innerHTML = `
            <p><strong>NAME:</strong> ${data.characterName}</p>
            <p><strong>HEALTH:</strong> ${data.health}%</p>
            <p><strong>STATUS:</strong> ${data.status || 'ACTIVE'}</p>
        `;
    }

    function renderZoneB(data) {
        if (!data || !Array.isArray(data)) return;

        const container = document.getElementById('comms-content');
        container.innerHTML = '';
        data.forEach(msg => {
            const div = document.createElement('div');
            div.className = 'comm-entry';
            div.innerHTML = `<span class="comm-source">[${msg.source}]:</span> ${msg.message}`;
            container.appendChild(div);
        });
    }

});
