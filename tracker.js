const axios = require('axios');
const noblox = require('noblox.js');

let isCurrentlyInGame = false; 

function cleanCookie(cookieString) {
    if (!cookieString) return "";
    let cleaned = cookieString.trim();
    
    // Remove surrounding quotes if Railway wrapped them in quotes
    if ((cleaned.startsWith('"') && cleaned.endsWith('"')) || (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
        cleaned = cleaned.slice(1, -1).trim();
    }
    
    // Strip out common key prefixes if they accidentally got included in the value
    cleaned = cleaned.replace(/^(ROBLOX_COOKIE|ROBLOSECURITY|\.ROBLOSECURITY)=/i, '');
    
    return cleaned.trim();
}

async function startNoblox() {
    try {
        const rawCookie = process.env.ROBLOSECURITY || process.env.ROBLOX_COOKIE;
        
        if (!rawCookie) {
            console.error("[DEBUG WARNING] No ROBLOSECURITY or ROBLOX_COOKIE found in environment variables!");
            return;
        }

        const validCookie = cleanCookie(rawCookie);
        const currentUser = await noblox.setCookie(validCookie);
        const username = currentUser.name || currentUser.UserName;
        console.log(`Logged into Roblox as ${username}`);
    } catch (err) {
        console.error("Failed to login to Roblox:", err.message);
    }
}

async function checkPresence(targetUserId, targetPlaceId, webhookUrl) {
    try {
        const headers = {};
        const rawCookie = process.env.ROBLOSECURITY || process.env.ROBLOX_COOKIE;
        
        if (rawCookie) {
            const validCookie = cleanCookie(rawCookie);
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
            const pingMessage = `<@&1460736233885007895>\n\n# <:DarthVader:1460772872896118965>  He Awaits you.. <:DarthVader:1460772872896118965>\n\n**Lord Vader has just joined the [game](https://www.roblox.com/games/${targetPlaceId})**!`;
            await sendDiscordAlert(webhookUrl, pingMessage);
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

async function sendDiscordAlert(webhookUrl, message) {
    if (!webhookUrl) {
        console.error("[Roblox Tracker Error] Webhook URL is missing or undefined! Check your Railway Environment Variables.");
        return;
    }
    try {
        await axios.post(webhookUrl, { content: message });
        console.log(`[Roblox Tracker] Webhook successfully delivered.`);
    } catch (error) {
        console.error("[Roblox Tracker Error] Discord rejected the webhook:", error.message);
    }
}

function startTracking(targetUserId, targetPlaceId, webhookUrl, intervalMs = 60000) {
    console.log(`[Roblox Tracker] Monitoring initialized for User ${targetUserId}. Checking every ${intervalMs / 1000}s...`);
    
    // Initialize noblox login on start
    startNoblox();
    
    // Run presence check once immediately on startup
    checkPresence(targetUserId, targetPlaceId, webhookUrl);
    
    // Check loop
    setInterval(() => {
        checkPresence(targetUserId, targetPlaceId, webhookUrl);
    }, intervalMs);
}

module.exports = { startTracking };