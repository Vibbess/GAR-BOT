const axios = require('axios');
const noblox = require('noblox.js');

let isCurrentlyInGame = false; 

// --- 1. Noblox & Cookie Setup ---
function cleanCookie(cookieString) {
    if (!cookieString) return "";
    if (cookieString.includes(".ROBLOSECURITY=")) {
        const match = cookieString.match(/\.ROBLOSECURITY=([^;]+)/);
        if (match) return match[1].trim();
    }
    return cookieString.trim();
}

async function startNoblox() {
    try {
        const validCookie = cleanCookie(process.env.ROBLOSECURITY);
        if (!validCookie) {
            console.log("[DEBUG WARNING] No ROBLOSECURITY found in env! Continuing unauthenticated...");
            return;
        }
        const currentUser = await noblox.setCookie(validCookie);
        const username = currentUser.name || currentUser.UserName;
        console.log(`[Noblox] Logged into Roblox as ${username}`);
    } catch (err) {
        console.error("[Noblox] Failed to login to Roblox:", err.message);
    }
}

// --- 2. Presence Checking Logic ---
async function checkPresence(targetUserId, targetPlaceId, webhookUrl) {
    try {
        const headers = {};
        
        // Grab the cleaned cookie for our axios request
        const validCookie = cleanCookie(process.env.ROBLOSECURITY);
        if (validCookie) {
            headers['Cookie'] = `.ROBLOSECURITY=${validCookie}`;
        }

        const response = await axios.post('https://presence.roblox.com/v1/presence/users', {
            userIds: [parseInt(targetUserId)]
        }, { headers });

        const userPresence = response.data.userPresences?.[0];
        if (!userPresence) {
            console.log("[Roblox Tracker] No presence data returned for this user.");
            return;
        }

        console.log(`[DEBUG] Target User: ${targetUserId} | API Status: ${userPresence.userPresenceType} | Playing Place ID: ${userPresence.placeId || 'null'}`);

        const isInGameNow = userPresence.userPresenceType === 2 && userPresence.placeId === parseInt(targetPlaceId);

        if (isInGameNow && !isCurrentlyInGame) {
            isCurrentlyInGame = true;
            console.log(`[Roblox Tracker] Match found! Sending join webhook...`);
            
            // Added the role ping <@&ROLE_ID> right before the message
            await sendDiscordAlert(
                webhookUrl, 
                `<@&1460736233885007895>\n# <:DarthVader:1460772872896118965>  He Awaits you.. <:DarthVader:1460772872896118965> **Lord Vader has just joined *the [game](https://www.roblox.com/games/${targetPlaceId})***!`
            );
        } 
        else if (!isInGameNow && isCurrentlyInGame) {
            isCurrentlyInGame = false;
            console.log(`[Roblox Tracker] User left. Sending leave webhook...`);
            await sendDiscordAlert(webhookUrl, `**Vader has left the game**.`);
        }

    } catch (error) {
        console.error("[Roblox Tracker Error] Failed to fetch data:", error.response ? error.response.data : error.message);
    }
}

// --- 3. Discord Webhook Sender ---
async function sendDiscordAlert(webhookUrl, message) {
    if (!webhookUrl) {
        console.error("[Roblox Tracker Error] Webhook URL is missing or undefined! Check your Environment Variables.");
        return;
    }
    try {
        await axios.post(webhookUrl, { content: message });
        console.log(`[Roblox Tracker] Webhook successfully delivered.`);
    } catch (error) {
        console.error("[Roblox Tracker Error] Discord rejected the webhook:", error.message);
    }
}

// --- 4. Initialization ---
async function startTracking(targetUserId, targetPlaceId, webhookUrl, intervalMs = 60000) {
    // Run the noblox login first
    await startNoblox();

    console.log(`[Roblox Tracker] Monitoring initialized for User ${targetUserId}. Checking every ${intervalMs / 1000}s...`);
    
    // Run once immediately on startup
    checkPresence(targetUserId, targetPlaceId, webhookUrl);
    
    // Start the check loop
    setInterval(() => {
        checkPresence(targetUserId, targetPlaceId, webhookUrl);
    }, intervalMs);
}

module.exports = { startTracking };