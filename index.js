const {
    Client,
    GatewayIntentBits,
    REST,
    Routes,
    SlashCommandBuilder,
    PermissionFlagsBits,
    ChannelType,
    MessageFlags,
    EmbedBuilder
} = require("discord.js");
const fs = require("fs");
const path = require("path");
const express = require("express");
const noblox = require("noblox.js");
const crypto = require("crypto");
require("dotenv").config();

// ==========================================
// CONFIGURATION & CONSTANTS
// ==========================================
const TRELLO_BOARD_ID = "aBYHEacW"; 
const TRELLO_DATA_LIST = "6aa490130f19f0d6385bf410"; // GAR Data List
const GROUP_ID = 34397388;
const MIN_CADET_RANK = 1;
const MAX_XP = 300;
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID; // Add this to Railway variables

const DIVISION_MAP = {
    "1530283425691472055": "Republic Intelligence",
    "1533959219349553294": "Coruscant Guard",
    "1534616449149309118": "501st Legion",
    "1533955640752341122": "Red Guards",
    "1527321284466180196": "7th Sky Corps",
    "1531722864024096981": "Advanced Recon Commandos"
};

const ROLES = {
    UNVERIFIED: "1548091737426370590",
    VERIFIED_1: "1530265063724679258",
    VERIFIED_2: "1530264541525446666",
    RANKS: {
        1: "1530265575211798569", 2: "1530265574364545085", 3: "1530265075548553226",
        4: "1530265074667884584", 5: "1530265074483331113", 6: "1530265073304735764",
        7: "1530265072801153128", 8: "1530265072029401178", 9: "1530265071781937183",
        10: "1530265070888681572", 11: "1530265070175780944", 12: "1530265069399572621",
        13: "1530265068347064505", 14: "1530265067696685157", 15: "1530265067298492418"
    }
};

const VERIFY_WORDS = ["clone", "blaster", "coruscant", "jedi", "sith", "republic", "empire", "droid", "kamino", "fleet", "galaxy", "force", "lightsaber", "walker", "helmet"];
const pendingVerifications = new Map();

// ==========================================
// DATABASE SETUP (Local JSON for Servers)
// ==========================================
const DATA_FILE = path.join(__dirname, "servers.json");

function loadServerData() {
    if (!fs.existsSync(DATA_FILE)) {
        const defaultData = { whitelistedServers: [], serverRoles: {} };
        fs.writeFileSync(DATA_FILE, JSON.stringify(defaultData, null, 2));
        return defaultData;
    }
    try {
        return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    } catch (err) {
        console.error("Error reading servers.json:", err);
        return { whitelistedServers: [], serverRoles: {} };
    }
}

function saveServerData(data) {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    } catch (err) {
        console.error("Error saving to servers.json:", err);
    }
}
const db = loadServerData();

function cleanCookie(cookieString) {
    if (!cookieString) return "";
    // If the input contains a full cookie string, extract the .ROBLOSECURITY value
    if (cookieString.includes(".ROBLOSECURITY=")) {
        const match = cookieString.match(/\.ROBLOSECURITY=([^;]+)/);
        if (match) {
            return match[1].trim();
        }
    }
    return cookieString.trim();
}

// Use it when logging into noblox
const rawCookie = process.env.ROBLOSECURITY;
const validCookie = cleanCookie(rawCookie);

async function startNoblox() {
    try {
        // FIX 1: Pass validCookie instead of process.env.ROBLOSECURITY
        const currentUser = await noblox.setCookie(validCookie);
        
        // FIX 2: Use .name (or fallback to .UserName for older noblox versions)
        const username = currentUser.name || currentUser.UserName;
        console.log(`Logged into Roblox as ${username}`);
    } catch (err) {
        console.error("Failed to login to Roblox:", err.message);
    }
}
startNoblox();

function generatePhrase() {
    let phrase = [];
    for (let i = 0; i < 4; i++) {
        phrase.push(VERIFY_WORDS[crypto.randomInt(0, VERIFY_WORDS.length)]);
    }
    return phrase.join(" ");
}

// ==========================================
// BGC HELPER FUNCTIONS
// ==========================================
async function fetchTrelloBlacklists() {
    try {
        const res = await fetch(`https://trello.com/b/${TRELLO_BOARD_ID}.json`);
        if (!res.ok) return [];
        const board = await res.json();
        const listMap = new Map();
        
        for (const list of board.lists || []) {
            listMap.set(list.id, DIVISION_MAP[list.id] || list.name);
        }

        const cards = [];
        for (const card of board.cards || []) {
            cards.push({
                id: card.id,
                name: (card.name || "").trim(),
                desc: (card.desc || "").trim(),
                list: listMap.get(card.idList) || "Unknown Board",
                due: card.due ? new Date(card.due) : null
            });
        }
        return cards;
    } catch (err) {
        console.error("Error fetching Trello data:", err);
        return [];
    }
}

function checkUserBlacklist(robloxUsername, robloxId, discordId, blacklistCards) {
    const unameLower = robloxUsername.toLowerCase();
    const rIdStr = String(robloxId).trim();
    const dIdStr = String(discordId).trim();
    const now = new Date();
    const matches = [];

    for (const card of blacklistCards) {
        const cardNameLower = card.name.toLowerCase();
        let isMatched = false;

        if (rIdStr && (card.name.includes(rIdStr) || card.desc.includes(rIdStr))) isMatched = true;
        if (!isMatched && unameLower && cardNameLower.startsWith(unameLower) && (cardNameLower.length === unameLower.length || [" ", "|"].includes(cardNameLower[unameLower.length]))) isMatched = true;
        if (!isMatched && dIdStr && (card.desc.includes(dIdStr) || card.name.includes(dIdStr))) isMatched = true;

        if (isMatched) {
            matches.push({ ...card, isOverdue: card.due && card.due < now });
        }
    }

    return { 
        isBlacklisted: matches.length > 0, 
        hasActiveBlacklist: matches.some(m => !m.isOverdue), 
        hasOverdueBlacklist: matches.some(m => m.isOverdue), 
        matches 
    };
}

async function checkGroupRank(robloxId, groupId) {
    try {
        const res = await fetch(`https://groups.roblox.com/v1/users/${robloxId}/groups/roles`);
        if (!res.ok) return { passed: false, rankName: "Not in Group", rankId: 0 };
        const data = await res.json();
        const groupInfo = data.data.find(g => g.group.id === Number(groupId));
        
        if (!groupInfo) return { passed: false, rankName: "Not in Group", rankId: 0 };
        return {
            passed: groupInfo.role.rank >= MIN_CADET_RANK,
            rankName: groupInfo.role.name,
            rankId: groupInfo.role.rank
        };
    } catch {
        return { passed: false, rankName: "Error", rankId: 0 };
    }
}

async function getBadgeCount(robloxId) {
    try {
        let total = 0, cursor = "";
        for (let i = 0; i < 2; i++) {
            const res = await fetch(`https://badges.roblox.com/v1/users/${robloxId}/badges?limit=100&sortOrder=Asc${cursor ? `&cursor=${cursor}` : ''}`);
            if (!res.ok) break;
            const data = await res.json();
            total += data.data.length;
            if (!data.nextPageCursor || total >= 125) break;
            cursor = data.nextPageCursor;
        }
        return total;
    } catch { return 0; }
}

async function checkClothingAndAccessories(robloxId) {
    try {
        const res = await fetch(`https://avatar.roblox.com/v1/users/${robloxId}/avatar`);
        if (!res.ok) return false;
        const data = await res.json();
        return data.assets && data.assets.length >= 6;
    } catch { return false; }
}

// ==========================================
// DISCORD BOT COMMANDS & SETUP
// ==========================================
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const commands = [
    new SlashCommandBuilder().setName("whitelist").setDescription("Whitelist a server ID (Admin only)").setDefaultMemberPermissions(PermissionFlagsBits.Administrator).addStringOption(opt => opt.setName("server_id").setDescription("Guild ID").setRequired(true)),
    new SlashCommandBuilder().setName("setbgcrole").setDescription("Grant/revoke /bgc permission (Admin only)").setDefaultMemberPermissions(PermissionFlagsBits.Administrator).addRoleOption(opt => opt.setName("role").setDescription("Role").setRequired(true)).addBooleanOption(opt => opt.setName("allowed").setDescription("True/False").setRequired(true)),
    new SlashCommandBuilder().setName("talk").setDescription("Send message to channel (Admin only)").setDefaultMemberPermissions(PermissionFlagsBits.Administrator).addChannelOption(opt => opt.setName("channel").setDescription("Text channel").setRequired(true).addChannelTypes(ChannelType.GuildText)).addStringOption(opt => opt.setName("message").setDescription("Content").setRequired(true)),
    new SlashCommandBuilder().setName("embed").setDescription("Send JSON embed (Admin only)").setDefaultMemberPermissions(PermissionFlagsBits.Administrator).addChannelOption(opt => opt.setName("channel").setDescription("Text channel").setRequired(true).addChannelTypes(ChannelType.GuildText)).addStringOption(opt => opt.setName("json").setDescription("JSON payload").setRequired(true)),
    new SlashCommandBuilder().setName("bgc").setDescription("Run a background check").addUserOption(opt => opt.setName("discord_user").setDescription("Discord User").setRequired(true)).addStringOption(opt => opt.setName("roblox_id").setDescription("Roblox ID").setRequired(true)),
    new SlashCommandBuilder().setName("verify").setDescription("Start the Roblox verification process").addStringOption(opt => opt.setName("roblox_username").setDescription("Exact Roblox username").setRequired(true)),
    new SlashCommandBuilder().setName("update").setDescription("Confirm verification and update roles"),
    new SlashCommandBuilder().setName("profile").setDescription("View GAR database profile").addStringOption(opt => opt.setName("roblox_username").setDescription("Roblox username").setRequired(true)),
    new SlashCommandBuilder().setName("ban").setDescription("Ban a user from the Roblox game via Trello").setDefaultMemberPermissions(PermissionFlagsBits.Administrator).addStringOption(opt => opt.setName("roblox_id").setDescription("Roblox ID").setRequired(true)).addStringOption(opt => opt.setName("reason").setDescription("Ban Reason").setRequired(true))
];

client.once("clientReady", async () => {
    console.log(`Logged in as ${client.user.tag}`);
    const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
    try {
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log("Registered slash commands successfully.");
    } catch (error) {
        console.error("Failed to register commands:", error);
    }
});

client.on("interactionCreate", async interaction => {
    if (!interaction.isChatInputCommand()) return;
    const { commandName, guildId } = interaction;

    if (!guildId) return interaction.reply({ content: "Commands can only be used inside a server.", flags: MessageFlags.Ephemeral });

    if (commandName === "whitelist") {
        const targetServerId = interaction.options.getString("server_id");
        if (!db.whitelistedServers.includes(targetServerId)) {
            db.whitelistedServers.push(targetServerId);
            saveServerData(db);
        }
        return interaction.reply({ content: `Successfully whitelisted server ID: \`${targetServerId}\`.`, flags: MessageFlags.Ephemeral });
    }

    if (!db.whitelistedServers.includes(guildId)) {
        return interaction.reply({ content: "This server is not whitelisted to use this bot.", flags: MessageFlags.Ephemeral });
    }

    if (commandName === "setbgcrole") {
        const role = interaction.options.getRole("role");
        const allowed = interaction.options.getBoolean("allowed");
        if (!db.serverRoles[guildId]) db.serverRoles[guildId] = [];

        if (allowed) {
            if (!db.serverRoles[guildId].includes(role.id)) db.serverRoles[guildId].push(role.id);
            saveServerData(db);
            return interaction.reply({ content: `Successfully **granted** \`/bgc\` access to ${role}.`, flags: MessageFlags.Ephemeral });
        } else {
            db.serverRoles[guildId] = db.serverRoles[guildId].filter(id => id !== role.id);
            saveServerData(db);
            return interaction.reply({ content: `Successfully **revoked** \`/bgc\` access from ${role}.`, flags: MessageFlags.Ephemeral });
        }
    }

    if (commandName === "talk") {
        const channel = interaction.options.getChannel("channel");
        const message = interaction.options.getString("message");
        try {
            await channel.send(message);
            await interaction.reply({ content: `Successfully sent message to ${channel}.`, flags: MessageFlags.Ephemeral });
        } catch (err) {
            await interaction.reply({ content: `Failed to send message: ${err.message}`, flags: MessageFlags.Ephemeral });
        }
    }

    if (commandName === "embed") {
        const channel = interaction.options.getChannel("channel");
        const rawJson = interaction.options.getString("json");
        try {
            const payload = JSON.parse(rawJson);
            const msgOpts = {};
            if (payload.content) msgOpts.content = payload.content;
            if (payload.embeds) msgOpts.embeds = payload.embeds;
            if (payload.attachments) msgOpts.files = payload.attachments;

            if (!msgOpts.content && (!msgOpts.embeds || msgOpts.embeds.length === 0)) {
                return interaction.reply({ content: "Invalid JSON: Payload must include content or embeds.", flags: MessageFlags.Ephemeral });
            }
            await channel.send(msgOpts);
            await interaction.reply({ content: `Successfully sent embed to ${channel}.`, flags: MessageFlags.Ephemeral });
        } catch (err) {
            await interaction.reply({ content: `**Failed to parse embed.**\n\`\`\`${err.message}\`\`\``, flags: MessageFlags.Ephemeral });
        }
    }

    if (commandName === "bgc") {
        const allowedRoles = db.serverRoles[guildId] || [];
        const hasPermission = interaction.member.permissions.has(PermissionFlagsBits.Administrator) || interaction.member.roles.cache.some(role => allowedRoles.includes(role.id));
        if (!hasPermission) return interaction.reply({ content: "You do not have permission to use this command.", flags: MessageFlags.Ephemeral });

        await interaction.deferReply();
        const discordUser = interaction.options.getUser("discord_user");
        const robloxId = interaction.options.getString("roblox_id");

        try {
            const robloxRes = await fetch(`https://users.roblox.com/v1/users/${robloxId}`);
            if (!robloxRes.ok) return interaction.editReply("Could not find a Roblox user with that ID.");
            
            const robloxData = await robloxRes.json();
            const joinDateRaw = new Date(robloxData.created);
            const formattedDate = `${joinDateRaw.getDate()}/${joinDateRaw.getMonth() + 1}/${joinDateRaw.getFullYear()}`;

            const [groupStatus, badgeCount, hasClothing, trelloCards] = await Promise.all([
                checkGroupRank(robloxId, GROUP_ID), getBadgeCount(robloxId),
                checkClothingAndAccessories(robloxId), fetchTrelloBlacklists()
            ]);

            const sixMonthsAgo = new Date();
            sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
            
            const blacklistResult = checkUserBlacklist(robloxData.name, robloxId, discordUser.id, trelloCards);
            let blacklistDisplay = "❌";
            if (blacklistResult.hasActiveBlacklist) blacklistDisplay = `✅ (${blacklistResult.matches.filter(m => !m.isOverdue).map(m => m.list).join(", ")})`;
            else if (blacklistResult.hasOverdueBlacklist) blacklistDisplay = "⚠️ (Overdue Card Found)";

            const overallPassed = (joinDateRaw <= sixMonthsAgo) && groupStatus.passed && (badgeCount >= 100) && hasClothing && !blacklistResult.hasActiveBlacklist;

            const bgcReport = `
**Roblox Username:** ${robloxData.name}
**Discord ID:** ${discordUser.id}
**Roblox Profile Link:** https://www.roblox.com/users/${robloxData.id}/profile
**Roblox Join Date:** ${formattedDate}
**Pages of Badges Amount:** ~${Math.ceil(badgeCount / 30)} pages (${badgeCount} total)
**Discord Badges?:** ${discordUser.flags && discordUser.flags.toArray().length > 0 ? "✅" : "❌"}
**Is the individual blacklisted from 501st?:** ${blacklistDisplay}

**The Requirements:**
Roblox Account 6+ months old: ${joinDateRaw <= sixMonthsAgo ? "✅" : "❌"}
Cadet+: ${groupStatus.passed ? "✅" : "❌"} (${groupStatus.rankName})
125 Badges+ on Roblox: ${badgeCount >= 100 ? "✅" : "❌"} (${badgeCount} badges)
One Page of Clothing or Accessories: ${hasClothing ? "✅" : "❌"}

**Passed the BGC:** ${overallPassed ? "✅" : "❌"}`.trim();

            await interaction.editReply(bgcReport);
        } catch (err) {
            console.error(err);
            await interaction.editReply("An error occurred while running the background check.");
        }
    }

    if (commandName === "verify") {
        const username = interaction.options.getString("roblox_username");
        try {
            const robloxId = await noblox.getIdFromUsername(username);
            const phrase = generatePhrase();
            pendingVerifications.set(interaction.user.id, { username, robloxId, phrase, time: Date.now() });
            
            return interaction.reply({
                content: `**Verification started for ${username}**\nPlease put the following phrase in your Roblox "About" section (Bio):\n\n\`${phrase}\`\n\nOnce done, run \`/update\`.`,
                flags: MessageFlags.Ephemeral
            });
        } catch (err) {
            return interaction.reply({ content: "Could not find that Roblox username.", flags: MessageFlags.Ephemeral });
        }
    }

    if (commandName === "update") {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const pending = pendingVerifications.get(interaction.user.id);
        
        if (!pending) return interaction.editReply("You haven't started verification. Run `/verify` first.");

        try {
            const blurb = await noblox.getBlurb(pending.robloxId);
            if (blurb.includes(pending.phrase)) {
                pendingVerifications.delete(interaction.user.id);
                const member = interaction.member;
                
                await member.roles.add([ROLES.VERIFIED_1, ROLES.VERIFIED_2]).catch(console.error);
                await member.roles.remove(ROLES.UNVERIFIED).catch(console.error);

                const groupRank = await checkGroupRank(pending.robloxId, GROUP_ID);
                if (groupRank.rankId && ROLES.RANKS[groupRank.rankId]) {
                    await member.roles.add(ROLES.RANKS[groupRank.rankId]).catch(console.error);
                }

                const cardName = `${pending.username} | ${pending.robloxId} | ${interaction.user.id}`;
                const defaultData = { leaderstats: { XP: 0, RXP: 0, Kills: 0 }, Gamepasses: {}, Settings: {}, ManualMedals: {}, PermaPerks: {} };
                
                // Check if card exists, create if not
                const res = await fetch(`https://api.trello.com/1/lists/${TRELLO_DATA_LIST}/cards?key=${process.env.TRELLO_KEY}&token=${process.env.TRELLO_TOKEN}`);
                const cards = await res.json();
                if (!cards.find(c => c.name.includes(`| ${pending.robloxId} |`))) {
                    await fetch(`https://api.trello.com/1/cards?idList=${TRELLO_DATA_LIST}&name=${encodeURIComponent(cardName)}&desc=${encodeURIComponent(JSON.stringify(defaultData))}&key=${process.env.TRELLO_KEY}&token=${process.env.TRELLO_TOKEN}`, { method: 'POST' });
                }

                return interaction.editReply(`Successfully verified as **${pending.username}**! Your roles and GAR data profile have been updated.`);
            } else {
                return interaction.editReply("Could not find the phrase in your Roblox bio. Make sure it's saved and try again.");
            }
        } catch (err) {
            console.error(err);
            return interaction.editReply("An error occurred during verification.");
        }
    }

    if (commandName === "profile") {
        await interaction.deferReply();
        const username = interaction.options.getString("roblox_username");
        
        try {
            const robloxId = await noblox.getIdFromUsername(username);
            const res = await fetch(`https://api.trello.com/1/lists/${TRELLO_DATA_LIST}/cards?key=${process.env.TRELLO_KEY}&token=${process.env.TRELLO_TOKEN}`);
            const cards = await res.json();
            const card = cards.find(c => c.name.includes(`| ${robloxId} |`));
            
            if (!card) return interaction.editReply(`No GAR Database profile found for **${username}**.`);
            
            const data = JSON.parse(card.desc || "{}");
            const xp = data.leaderstats ? data.leaderstats.XP : 0;
            const isBanned = data.isBanned ? `Yes (Reason: ${data.banReason})` : "No";

            const embed = new EmbedBuilder()
                .setTitle(`${username}'s GAR Profile`)
                .setColor(data.isBanned ? 0xff0000 : 0x0099ff)
                .addFields(
                    { name: "Roblox ID", value: String(robloxId), inline: true },
                    { name: "XP", value: String(xp), inline: true },
                    { name: "Banned", value: isBanned, inline: false }
                );
            return interaction.editReply({ embeds: [embed] });
        } catch (err) {
            return interaction.editReply("Error finding user profile.");
        }
    }

    if (commandName === "ban") {
        await interaction.deferReply();
        const rId = interaction.options.getString("roblox_id");
        const reason = interaction.options.getString("reason");
        
        try {
            const res = await fetch(`https://api.trello.com/1/lists/${TRELLO_DATA_LIST}/cards?key=${process.env.TRELLO_KEY}&token=${process.env.TRELLO_TOKEN}`);
            const cards = await res.json();
            const targetCard = cards.find(c => c.name.includes(`| ${rId} |`));
            
            if (!targetCard) return interaction.editReply("Could not find a GAR database entry for that Roblox ID.");

            let data = JSON.parse(targetCard.desc || "{}");
            data.isBanned = true;
            data.banReason = reason;
            
            await fetch(`https://api.trello.com/1/cards/${targetCard.id}?desc=${encodeURIComponent(JSON.stringify(data))}&name=${encodeURIComponent("[BANNED] " + targetCard.name)}&key=${process.env.TRELLO_KEY}&token=${process.env.TRELLO_TOKEN}`, { method: 'PUT' });
            
            return interaction.editReply(`Successfully banned Roblox ID **${rId}**. They will be kicked upon joining the game.`);
        } catch (err) {
            return interaction.editReply("API error occurred while processing ban.");
        }
    }
});

// ==========================================
// EXPRESS SERVER (ROBLOX GAME API)
// ==========================================
const app = express();
app.use(express.json());

// HEALTH CHECK ROUTE
app.get("/", (req, res) => {
    res.status(200).send("GAR Bot API is online and accepting requests!");
});
app.use(express.json());

app.post("/api/playerData", async (req, res) => {
    const { robloxId, username, action, data } = req.body;
    const startTime = Date.now();

    try {
        // Verify Trello environment variables exist
        if (!process.env.TRELLO_KEY || !process.env.TRELLO_TOKEN) {
            console.error("❌ Missing TRELLO_KEY or TRELLO_TOKEN environment variables in Railway!");
            return res.status(500).json({ error: "Server missing Trello credentials" });
        }

        const trelloRes = await fetch(
            `https://api.trello.com/1/lists/${TRELLO_DATA_LIST}/cards?key=${process.env.TRELLO_KEY}&token=${process.env.TRELLO_TOKEN}`
        );

        if (!trelloRes.ok) {
            const errorText = await trelloRes.text();
            console.error(`❌ Trello API Request Failed (${trelloRes.status}): ${errorText}`);
            return res.status(500).json({ error: `Trello Error: ${errorText}` });
        }

        const cards = await trelloRes.json();
        let card = cards.find(c => c.name.includes(`| ${robloxId} |`));

        if (!card) return res.status(404).json({ error: "Unverified player" });

        let cardData = JSON.parse(card.desc || "{}");
        
        if (action === "load") {
            if (cardData.isBanned) return res.json({ banned: true, reason: cardData.banReason });
            
            logToDiscord(username, robloxId, "joined", cardData, startTime);
            return res.json({ success: true, data: cardData });
        } 
        
        if (action === "save") {
            if (data && data.leaderstats && data.leaderstats.XP !== undefined) {
                let currentXP = Math.min(data.leaderstats.XP, MAX_XP);
                let newRankId = Math.floor(currentXP / 5) + 1;
                
                const groupRank = await noblox.getRankInGroup(GROUP_ID, robloxId);
                if (groupRank >= 1 && groupRank <= 13 && newRankId > groupRank && newRankId <= 14) {
                    await noblox.setRank(GROUP_ID, robloxId, newRankId).catch(console.error);
                }
            }

            const putRes = await fetch(
                `https://api.trello.com/1/cards/${card.id}?desc=${encodeURIComponent(JSON.stringify(data))}&key=${process.env.TRELLO_KEY}&token=${process.env.TRELLO_TOKEN}`,
                { method: 'PUT' }
            );

            if (!putRes.ok) {
                const putErrText = await putRes.text();
                console.error(`❌ Failed to update Trello card: ${putErrText}`);
            }
            
            logToDiscord(username, robloxId, "left", data, startTime);
            return res.json({ success: true });
        }

        return res.status(400).json({ error: "Invalid action" });
    } catch (err) {
        console.error("❌ Roblox API Internal Server Error:", err);
        return res.status(500).json({ error: "Internal Server Error", details: err.message });
    }
});

function logToDiscord(username, robloxId, action, data, startTime) {
    const channel = client.channels.cache.get(LOG_CHANNEL_ID);
    if (!channel) return;
    
    const timeTaken = ((Date.now() - startTime) / 1000).toFixed(3);
    const actionText = action === "joined" ? "playerdataloading" : "playerdatasaving";
    let formattedText = `${username} (${robloxId}) ${action} ${Date.now()}\n\`${actionText}\`\n`;
    
    if (action === "joined") {
        for (const [category, values] of Object.entries(data)) {
            if (typeof values === 'object') {
                formattedText += `\n**${category}**\n`;
                for (const [k, v] of Object.entries(values)) {
                    formattedText += `${k}: ${v}\n`;
                }
            }
        }
        formattedText += `\n\nplayerdata loaded in ${timeTaken}s`;
    } else {
        formattedText += `\`\`\`json\n${JSON.stringify(data)}\n\`\`\`\nplayer data saved to Railway & Trello in ${timeTaken}s`;
    }

    channel.send(formattedText).catch(console.error);
}

// Start Server and Discord Bot
const PORT = process.env.PORT || 8080;

app.listen(PORT, "0.0.0.0", () => {
    console.log(`✅ Roblox API Server successfully running on port ${PORT}`);
}).on('error', (err) => {
    console.error("❌ Express Server failed to start:", err);
});

client.login(process.env.DISCORD_TOKEN).catch(err => {
    console.error("❌ Discord Bot failed to login:", err);
});