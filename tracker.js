const axios = require('axios');

let isCurrentlyInGame = false; 

async function checkPresence(targetUserId, targetPlaceId, webhookUrl) {
    try {
        const headers = {};
        
        // 1. Debug and Validate the Cookie
        if (process.env.ROBLOX_COOKIE) {
            let cookieValue = process.env.ROBLOX_COOKIE.trim();
            
            // Auto-fix: Remove duplicate prefix if accidentally pasted into Railway
            if (cookieValue.startsWith('.ROBLOSECURITY=')) {
                cookieValue = cookieValue.replace('.ROBLOSECURITY=', '');
            }
            
            headers['Cookie'] = `.ROBLOSECURITY=${cookieValue}`;
            console.log(`[DEBUG] Cookie injected. Starts with: ${cookieValue.substring(0, 40)}...`);
        } else {
            console.log("[DEBUG WARNING] No ROBLOX_COOKIE found in environment variables! Sending unauthenticated guest request.");
        }

        // 2. Fetch Presence Data from Roblox
        const response = await axios.post('https://presence.roblox.com/v1/presence/users', {
            userIds: [parseInt(targetUserId)]
        }, { headers });

        const userPresence = response.data.userPresences?.[0];
        if (!userPresence) {
            console.log("[Roblox Tracker] No presence data returned for this user.");
            return;
        }

        // Enhanced Live status logs
        console.log(`[DEBUG] Target User: ${targetUserId} | API Status: ${userPresence.userPresenceType} | Playing Place ID: ${userPresence.placeId || 'null'}`);

        // 3. Evaluate Status and Send Webhook Alerts
        const isInGameNow = userPresence.userPresenceType === 2 && userPresence.placeId === parseInt(targetPlaceId);

        if (isInGameNow && !isCurrentlyInGame) {
            isCurrentlyInGame = true;
            console.log(`[Roblox Tracker] Match found! Sending join webhook...`);
            await sendDiscordAlert(webhookUrl, `<@&1460736233885007895>\n\n# <:DarthVader:1460772872896118965>  He Awaits you.. <:DarthVader:1460772872896118965>\n\n**Lord Vader has just joined the [game](https://www.roblox.com/games/${targetPlaceId})**!`);
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
    
    // Run once immediately on startup
    checkPresence(targetUserId, targetPlaceId, webhookUrl);
    
    // Check loop
    setInterval(() => {
        checkPresence(targetUserId, targetPlaceId, webhookUrl);
    }, intervalMs);
}

module.exports = { startTracking };