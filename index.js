const {
    Client,
    GatewayIntentBits,
    REST,
    Routes,
    SlashCommandBuilder,
    PermissionFlagsBits,
    ChannelType,
    MessageFlags
} = require("discord.js");
const fs = require("fs");
const path = require("path");

const TRELLO_BOARD_ID = "aBYHEacW";
const GROUP_ID = "34397388"; 
const MIN_CADET_RANK = 1;   

const DIVISION_MAP = {
    "1530283425691472055": "Republic Intelligence",
    "1533959219349553294": "Coruscant Guard",
    "1534616449149309118": "501st Legion",
    "1533955640752341122": "Red Guards",
    "1527321284466180196": "7th Sky Corps",
    "1531722864024096981": "Advanced Recon Commandos"
};

const DATA_FILE = path.join(__dirname, "servers.json");

function loadServerData() {
    if (!fs.existsSync(DATA_FILE)) {
        const defaultData = { whitelistedServers: [], serverRoles: {} };
        fs.writeFileSync(DATA_FILE, JSON.stringify(defaultData, null, 2));
        return defaultData;
    }
    try {
        const raw = fs.readFileSync(DATA_FILE, "utf8");
        return JSON.parse(raw);
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

const client = new Client({
    intents: [GatewayIntentBits.Guilds]
});

async function fetchTrelloBlacklists() {
    try {
        const res = await fetch(`https://trello.com/b/${TRELLO_BOARD_ID}.json`);
        if (!res.ok) return [];

        const board = await res.json();
        const listMap = new Map();
        
        for (const list of board.lists || []) {
            const divName = DIVISION_MAP[list.id] || list.name;
            listMap.set(list.id, divName);
        }

        const cards = [];
        for (const card of board.cards || []) {
            const listName = listMap.get(card.idList) || "Unknown Board";
            cards.push({
                id: card.id,
                name: (card.name || "").trim(),
                desc: (card.desc || "").trim(),
                list: listName,
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
        const cardDesc = card.desc;
        let isMatched = false;

        if (rIdStr && (card.name.includes(rIdStr) || cardDesc.includes(rIdStr))) {
            isMatched = true;
        }

        if (!isMatched && unameLower) {
            if (cardNameLower.startsWith(unameLower) && 
               (cardNameLower.length === unameLower.length || [" ", "|"].includes(cardNameLower[unameLower.length]))) {
                isMatched = true;
            }
        }

        if (!isMatched && dIdStr && (cardDesc.includes(dIdStr) || card.name.includes(dIdStr))) {
            isMatched = true;
        }

        if (isMatched) {
            const isOverdue = card.due && card.due < now;
            matches.push({ ...card, isOverdue });
        }
    }

    const hasActiveBlacklist = matches.some(m => !m.isOverdue);
    const hasOverdueBlacklist = matches.some(m => m.isOverdue);

    return { isBlacklisted: matches.length > 0, hasActiveBlacklist, hasOverdueBlacklist, matches };
}

async function checkGroupRank(robloxId, groupId) {
    try {
        const res = await fetch(`https://groups.roblox.com/v1/users/${robloxId}/groups/roles`);
        if (!res.ok) return { passed: false, rankName: "Not in Group" };
        const data = await res.json();
        const groupInfo = data.data.find(g => g.group.id === Number(groupId));
        
        if (!groupInfo) return { passed: false, rankName: "Not in Group" };
        return {
            passed: groupInfo.role.rank >= MIN_CADET_RANK,
            rankName: groupInfo.role.name
        };
    } catch {
        return { passed: false, rankName: "Error" };
    }
}

async function getBadgeCount(robloxId) {
    try {
        let totalBadges = 0;
        let cursor = "";
        for (let i = 0; i < 2; i++) {
            const url = `https://badges.roblox.com/v1/users/${robloxId}/badges?limit=100&sortOrder=Asc${cursor ? `&cursor=${cursor}` : ''}`;
            const res = await fetch(url);
            if (!res.ok) break;
            
            const data = await res.json();
            totalBadges += data.data.length;
            if (!data.nextPageCursor || totalBadges >= 125) break;
            cursor = data.nextPageCursor;
        }
        return totalBadges;
    } catch {
        return 0;
    }
}

async function checkClothingAndAccessories(robloxId) {
    try {
        const res = await fetch(`https://avatar.roblox.com/v1/users/${robloxId}/avatar`);
        if (!res.ok) return false;
        const data = await res.json();
        return data.assets && data.assets.length >= 6;
    } catch {
        return false;
    }
}

const commands = [
    new SlashCommandBuilder()
        .setName("whitelist")
        .setDescription("Whitelist a server ID for bot usage (Admin only)")
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption(option =>
            option.setName("server_id")
                .setDescription("Target Server (Guild) ID")
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName("setbgcrole")
        .setDescription("Grant or revoke /bgc permission for a role (Admin only)")
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addRoleOption(option =>
            option.setName("role")
                .setDescription("Role to modify")
                .setRequired(true)
        )
        .addBooleanOption(option =>
            option.setName("allowed")
                .setDescription("True to allow, false to deny")
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName("talk")
        .setDescription("Sends a message to a specific channel (Admin only)")
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addChannelOption(option =>
            option.setName("channel")
                .setDescription("Target text channel")
                .setRequired(true)
                .addChannelTypes(ChannelType.GuildText)
        )
        .addStringOption(option =>
            option.setName("message")
                .setDescription("Message content")
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName("embed")
        .setDescription("Send a custom Discohook-style JSON embed (Admin only)")
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addChannelOption(option =>
            option.setName("channel")
                .setDescription("Target text channel")
                .setRequired(true)
                .addChannelTypes(ChannelType.GuildText)
        )
        .addStringOption(option =>
            option.setName("json")
                .setDescription("Paste raw Discohook JSON payload here")
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName("bgc")
        .setDescription("Run a background check on a Roblox ID")
        .addUserOption(option =>
            option.setName("discord_user")
                .setDescription("Target Discord account")
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName("roblox_id")
                .setDescription("Target Roblox User ID")
                .setRequired(true)
        )
];

client.once("clientReady", async () => {
    console.log(`Logged in as ${client.user.tag}`);

    const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
    try {
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commands }
        );
        console.log("Registered slash commands successfully.");
    } catch (error) {
        console.error("Failed to register commands:", error);
    }
});

client.on("interactionCreate", async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName, guildId } = interaction;

    if (!guildId) {
        return interaction.reply({ content: "Commands can only be used inside a server.", flags: MessageFlags.Ephemeral });
    }

    if (commandName === "whitelist") {
        const targetServerId = interaction.options.getString("server_id");
        
        if (!db.whitelistedServers.includes(targetServerId)) {
            db.whitelistedServers.push(targetServerId);
            saveServerData(db);
        }

        return interaction.reply({ 
            content: `Successfully whitelisted server ID: \`${targetServerId}\`.`, 
            flags: MessageFlags.Ephemeral 
        });
    }

    if (!db.whitelistedServers.includes(guildId)) {
        return interaction.reply({ 
            content: "This server is not whitelisted to use this bot.", 
            flags: MessageFlags.Ephemeral 
        });
    }

    if (commandName === "setbgcrole") {
        const role = interaction.options.getRole("role");
        const allowed = interaction.options.getBoolean("allowed");

        if (!db.serverRoles[guildId]) {
            db.serverRoles[guildId] = [];
        }

        if (allowed) {
            if (!db.serverRoles[guildId].includes(role.id)) {
                db.serverRoles[guildId].push(role.id);
            }
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
            const messageOptions = {};
            if (payload.content) messageOptions.content = payload.content;
            if (payload.embeds) messageOptions.embeds = payload.embeds;
            if (payload.attachments) messageOptions.files = payload.attachments;

            if (!messageOptions.content && (!messageOptions.embeds || messageOptions.embeds.length === 0)) {
                return interaction.reply({ content: "Invalid JSON: Payload must include content or embeds.", flags: MessageFlags.Ephemeral });
            }

            await channel.send(messageOptions);
            await interaction.reply({ content: `Successfully sent embed to ${channel}.`, flags: MessageFlags.Ephemeral });
        } catch (err) {
            await interaction.reply({ 
                content: `**Failed to parse or send embed.** Ensure you copied valid JSON from Discohook.\n\`\`\`${err.message}\`\`\``, 
                flags: MessageFlags.Ephemeral 
            });
        }
    }

    if (commandName === "bgc") {
        const allowedRoles = db.serverRoles[guildId] || [];
        const memberRoles = interaction.member.roles.cache;
        const hasPermission = interaction.member.permissions.has(PermissionFlagsBits.Administrator) || 
                              memberRoles.some(role => allowedRoles.includes(role.id));

        if (!hasPermission) {
            return interaction.reply({ content: "You do not have permission to use this command.", flags: MessageFlags.Ephemeral });
        }

        await interaction.deferReply();

        const discordUser = interaction.options.getUser("discord_user");
        const robloxId = interaction.options.getString("roblox_id");

        try {
            const robloxRes = await fetch(`https://users.roblox.com/v1/users/${robloxId}`);
            if (!robloxRes.ok) {
                return interaction.editReply("Could not find a Roblox user with that ID.");
            }

            const robloxData = await robloxRes.json();
            const joinDateRaw = new Date(robloxData.created);
            const formattedDate = `${joinDateRaw.getDate()}/${joinDateRaw.getMonth() + 1}/${joinDateRaw.getFullYear()}`;

            const [groupStatus, badgeCount, hasClothing, trelloCards] = await Promise.all([
                checkGroupRank(robloxId, GROUP_ID),
                getBadgeCount(robloxId),
                checkClothingAndAccessories(robloxId),
                fetchTrelloBlacklists()
            ]);

            const sixMonthsAgo = new Date();
            sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
            const isSixMonthsOld = joinDateRaw <= sixMonthsAgo;
            const passedBadgeCheck = badgeCount >= 100;
            const passedCadetCheck = groupStatus.passed;
            const passedClothingCheck = hasClothing;

            const blacklistResult = checkUserBlacklist(robloxData.name, robloxId, discordUser.id, trelloCards);
            
            let blacklistDisplay = "❌";
            if (blacklistResult.hasActiveBlacklist) {
                const activeMatches = blacklistResult.matches.filter(m => !m.isOverdue).map(m => m.list).join(", ");
                blacklistDisplay = `✅ (${activeMatches})`;
            } else if (blacklistResult.hasOverdueBlacklist) {
                blacklistDisplay = "⚠️ (Overdue Card Found)";
            }

            const discordFlags = discordUser.flags ? discordUser.flags.toArray() : [];
            const hasDiscordBadges = discordFlags.length > 0 ? "✅" : "❌";

            const overallPassed = isSixMonthsOld && passedCadetCheck && passedBadgeCheck && passedClothingCheck && !blacklistResult.hasActiveBlacklist;

            const bgcReport = `
**Roblox Username:** ${robloxData.name}
**Discord ID:** ${discordUser.id}
**Roblox Profile Link:** https://www.roblox.com/users/${robloxData.id}/profile
**Roblox Join Date:** ${formattedDate}
**Pages of Badges Amount:** ~${Math.ceil(badgeCount / 30)} pages (${badgeCount} total)
**Discord Badges?:** ${hasDiscordBadges}
**Is the individual blacklisted from 501st?:** ${blacklistDisplay}

**The Requirements:**
Roblox Account 6+ months old: ${isSixMonthsOld ? "✅" : "❌"}
Cadet+: ${passedCadetCheck ? "✅" : "❌"} (${groupStatus.rankName})
125 Badges+ on Roblox: ${passedBadgeCheck ? "✅" : "❌"} (${badgeCount} badges)
One Page of Clothing or Accessories: ${passedClothingCheck ? "✅" : "❌"}

**Passed the BGC:** ${overallPassed ? "✅" : "❌"}
            `.trim();

            await interaction.editReply(bgcReport);

        } catch (err) {
            console.error(err);
            await interaction.editReply("An error occurred while running the background check.");
        }
    }
});

client.login(process.env.DISCORD_TOKEN);