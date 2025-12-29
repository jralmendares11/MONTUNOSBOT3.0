"use strict";

require("dotenv").config();

const http = require("http");
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  WebhookClient
} = require("discord.js");

// ================== BOOT LOGS ==================
console.log("=== BOOT ===", new Date().toISOString());
console.log("NODE:", process.version);
console.log("DEBUG ENV:", process.env.DEBUG);
console.log("GUILD_ID:", process.env.GUILD_ID);
console.log("TOKEN length:", (process.env.DISCORD_TOKEN || "").length);

// ================== SAFETY LOGGING ==================
process.on("unhandledRejection", (e) => console.error("❌ UNHANDLED REJECTION:", e));
process.on("uncaughtException", (e) => console.error("❌ UNCAUGHT EXCEPTION:", e));

// ================== ENV ==================
const env = {
  TOKEN: process.env.DISCORD_TOKEN,
  GUILD_ID: process.env.GUILD_ID,

  ROLE_WHITELIST: process.env.ROLE_WHITELIST_ID,
  ROLE_DENIED: process.env.ROLE_DENIED_ID,

  ROLE_WD_WHITELIST: process.env.ROLE_WD_WHITELIST_ID,
  ROLE_WD_DENIED: process.env.ROLE_WD_DENIED_ID,

  PUBLIC_CHANNEL: process.env.PUBLIC_CHANNEL_ID,
  LOG_CHANNEL: process.env.LOG_CHANNEL_ID,
  WD_LOG_CHANNEL: process.env.WD_LOG_CHANNEL_ID,

  WD_WEBHOOK_URL: process.env.WD_WEBHOOK_URL,

  // ✅ SOLO ESTE ROL PUEDE USAR LOS COMANDOS (EN CUALQUIER CANAL)
  ALLOWED_ROLE: process.env.ALLOWED_ROLE_ID,

  PORT: Number(process.env.PORT || 10000)
};

function requireEnv(keys) {
  const missing = keys.filter((k) => !env[k]);
  if (missing.length) {
    console.error("❌ FALTAN VARIABLES DE ENTORNO:", missing.join(", "));
    console.error("Revisa Railway/Render -> Variables y vuelve a desplegar.");
    process.exit(1);
  }
}

// Obligatorias para que TODO funcione:
requireEnv([
  "TOKEN",
  "GUILD_ID",
  "ROLE_WHITELIST",
  "ROLE_DENIED",
  "ROLE_WD_WHITELIST",
  "ROLE_WD_DENIED",
  "PUBLIC_CHANNEL",
  "LOG_CHANNEL",
  "WD_LOG_CHANNEL",
  "ALLOWED_ROLE"
]);

const wdWebhook = env.WD_WEBHOOK_URL ? new WebhookClient({ url: env.WD_WEBHOOK_URL }) : null;

// ================== KEEP-ALIVE HTTP ==================
http
  .createServer((req, res) => {
    if (req.url === "/health" || req.url === "/") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("ok");
      return;
    }
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("not found");
  })
  .listen(env.PORT, () => {
    console.log(`Servidor HTTP keep-alive activo en puerto ${env.PORT}`);
  });

// ================== DISCORD CLIENT ==================
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

client.on("error", (e) => console.error("❌ DISCORD CLIENT ERROR:", e));
client.on("shardError", (e) => console.error("❌ DISCORD SHARD ERROR:", e));
client.on("warn", (m) => console.warn("⚠️ DISCORD WARN:", m));

// ================== READY WATCHDOG ==================
let readyFired = false;
setTimeout(() => {
  if (!readyFired) {
    console.error("⏳ TIMEOUT: Pasaron 25s y el bot NO llegó a READY. Revisa token/gateway/permiso.");
  }
}, 25000);

// ================== DE-DUP ==================
const recentInteractionIds = new Map(); // id -> timestamp
function seenInteraction(id) {
  const now = Date.now();
  for (const [k, ts] of recentInteractionIds) {
    if (now - ts > 5 * 60 * 1000) recentInteractionIds.delete(k);
  }
  if (recentInteractionIds.has(id)) return true;
  recentInteractionIds.set(id, now);
  return false;
}

// ================== COMMANDS ==================
function buildCommands() {
  const idOpt = (b) =>
    b.addStringOption((option) =>
      option.setName("id").setDescription("ID del usuario").setRequired(true)
    );

  return [
    idOpt(new SlashCommandBuilder().setName("wlpass").setDescription("Aprobar whitelist de un usuario")),
    idOpt(new SlashCommandBuilder().setName("wldenied").setDescription("Denegar whitelist de un usuario")),
    idOpt(new SlashCommandBuilder().setName("wdpass").setDescription("Aprobar whitelist DELICTIVA (WD)")),
    idOpt(new SlashCommandBuilder().setName("wddenied").setDescription("Denegar whitelist DELICTIVA (WD)"))
  ].map((c) => c.toJSON());
}

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(env.TOKEN);
  console.log("Intentando registrar comandos en GUILD:", env.GUILD_ID);

  const commands = buildCommands();
  await rest.put(Routes.applicationGuildCommands(client.user.id, env.GUILD_ID), {
    body: commands
  });

  console.log("✔️ Comandos registrados correctamente");
}

// ================== HELPERS ==================
function isValidDiscordId(s) {
  return typeof s === "string" && /^[0-9]{17,20}$/.test(s.trim());
}

async function safeFetchChannel(guild, channelId) {
  try {
    return await guild.channels.fetch(channelId);
  } catch {
    return null;
  }
}

async function safeFetchMember(guild, userId) {
  try {
    return await guild.members.fetch(userId);
  } catch {
    return null;
  }
}

async function safeSend(channel, payload) {
  try {
    await channel.send(payload);
  } catch (e) {
    console.error("Error enviando mensaje a canal:", e);
  }
}

async function safeAddRole(member, roleId) {
  try {
    await member.roles.add(roleId);
  } catch (e) {
    console.error("Error agregando rol:", roleId, "->", e);
    throw e;
  }
}

// ================== READY ==================
client.once("ready", async () => {
  readyFired = true;

  console.log("=========== READY ===========");
  console.log(`Bot: ${client.user.tag}`);
  console.log(`Guild configurada: ${env.GUILD_ID}`);

  try {
    await registerCommands();
  } catch (e) {
    console.error("❌ Error registrando comandos:", e);
  }
});

// ================== LÓGICA DE COMANDOS ==================
client.on("interactionCreate", async (interaction) => {
  try {
    if (!interaction.isChatInputCommand()) return;
    if (seenInteraction(interaction.id)) return;

    // 🔥 LOG PARA QUE SÍ SALGA EN RAILWAY
    console.log(
      "➡️ CMD:",
      interaction.commandName,
      "| by:",
      interaction.user?.tag,
      `(${interaction.user?.id})`,
      "| channel:",
      interaction.channelId
    );

    // ✅ PERMISO SOLO POR ROL (NO IMPORTA EL CANAL)
    const member = interaction.member; // GuildMember
    if (!member?.roles?.cache?.has(env.ALLOWED_ROLE)) {
      console.log("⛔ Sin permiso (rol). user:", interaction.user?.id);
      await interaction.reply({
        content: "❌ No tienes permisos para usar este comando.",
        ephemeral: true
      });
      return;
    }

    const cmd = interaction.commandName;

    const guild = interaction.guild || (await client.guilds.fetch(env.GUILD_ID));
    const userId = (interaction.options.getString("id") || "").trim();

    await interaction.deferReply({ ephemeral: true });

    if (!isValidDiscordId(userId)) {
      await interaction.editReply("❌ Ese ID no parece válido (debe ser solo números).");
      return;
    }

    const target = await safeFetchMember(guild, userId);
    if (!target) {
      await interaction.editReply("❌ No encontré ese usuario en el servidor.");
      return;
    }

    // ========= WL APROBADA =========
    if (cmd === "wlpass") {
      await safeAddRole(target, env.ROLE_WHITELIST);

      const logChannel = await safeFetchChannel(guild, env.LOG_CHANNEL);
      if (logChannel) await safeSend(logChannel, `🟢 <@${interaction.user.id}> aprobó una WL → <@${userId}>`);

      const publicChannel = await safeFetchChannel(guild, env.PUBLIC_CHANNEL);
      if (publicChannel) {
        await safeSend(publicChannel, {
          content:
            ` ᴡʜɪᴛᴇʟɪsᴛ ᴀᴘʀᴏʙᴀᴅᴀ <@${userId}> — ` +
            `**ᴀsɪ́ sɪ́, Bienvenido Montuno. ғᴏʀᴍᴜʟᴀʀɪᴏ ʟɪᴍᴘɪᴏ. ᴀᴅᴇʟᴀɴᴛᴇ.**`,
          files: ["./assets/wlpass.gif"]
        });
      }

      console.log("✅ wlpass aplicado a:", userId);
      await interaction.editReply("✔️ WL aprobada.");
      return;
    }

    // ========= WL DENEGADA =========
    if (cmd === "wldenied") {
      await safeAddRole(target, env.ROLE_DENIED);

      const logChannel = await safeFetchChannel(guild, env.LOG_CHANNEL);
      if (logChannel) await safeSend(logChannel, `🔴 <@${interaction.user.id}> denegó una WL → <@${userId}>`);

      const publicChannel = await safeFetchChannel(guild, env.PUBLIC_CHANNEL);
      if (publicChannel) {
        await safeSend(publicChannel, {
          content:
            ` ᴡʜɪᴛᴇʟɪsᴛ ᴅᴇɴᴇɢᴀᴅᴀ <@${userId}> — ` +
            `**ʀᴇᴠɪsᴇ ʟᴀs ɴᴏʀᴍᴀs ᴀɴᴛᴇs ᴅᴇ ᴠᴏʟᴠᴇʀ.**`,
          files: ["./assets/wldenied.gif"]
        });
      }

      console.log("✅ wldenied aplicado a:", userId);
      await interaction.editReply("❌ Denegado.");
      return;
    }

    // ========= WD WL APROBADA =========
    if (cmd === "wdpass") {
      await safeAddRole(target, env.ROLE_WD_WHITELIST);

      const logChannel = await safeFetchChannel(guild, env.WD_LOG_CHANNEL);
      if (logChannel) await safeSend(logChannel, `🟢 <@${interaction.user.id}> aprobó **WL Delictiva** → <@${userId}>`);

      if (wdWebhook) {
        wdWebhook
          .send({
            content:
              `✅ **ʜᴀ sɪᴅᴏ ᴀᴘʀᴏʙᴀᴅᴏ ᴘᴀʀᴀ ᴇʟ ʀᴏʟ ᴅᴇʟɪᴄᴛɪᴠᴏ** <@${userId}> — ` +
              `**ᴇʟ ʀᴏʟ ʜᴀʙʟᴀʀᴀ ᴘᴏʀ ᴠᴏs, ɴᴏ ʟᴏs ᴅɪsᴘᴀʀᴏs.**`,
            files: [{ attachment: "./assets/wdpass.gif", name: "wdpass.gif" }]
          })
          .catch(console.error);
      }

      console.log("✅ wdpass aplicado a:", userId);
      await interaction.editReply("✔️ WL Delictiva aprobada.");
      return;
    }

    // ========= WD WL DENEGADA =========
    if (cmd === "wddenied") {
      await safeAddRole(target, env.ROLE_WD_DENIED);

      const logChannel = await safeFetchChannel(guild, env.WD_LOG_CHANNEL);
      if (logChannel) await safeSend(logChannel, `🔴 <@${interaction.user.id}> denegó **WL Delictiva** → <@${userId}>`);

      if (wdWebhook) {
        wdWebhook
          .send({
            content:
              `❌ **ᴀᴘʟɪᴄᴀᴄɪᴏ́ɴ ᴅᴇʟɪᴄᴛɪᴠᴀ ᴅᴇɴᴇɢᴀᴅᴀ** <@${userId}> — ` +
              `**ᴘᴜᴇᴅᴇs ᴠᴏʟᴠᴇʀ ᴀ ɪɴᴛᴇɴᴛᴀʀʟᴏ ᴍᴀ́s ᴀᴅᴇʟᴀɴᴛᴇ.**`,
            files: [{ attachment: "./assets/wddenied.gif", name: "wddenied.gif" }]
          })
          .catch(console.error);
      }

      console.log("✅ wddenied aplicado a:", userId);
      await interaction.editReply("❌ WL Delictiva denegada.");
      return;
    }

    await interaction.editReply("❌ Comando no reconocido.");
  } catch (err) {
    console.error("Error general en interactionCreate:", err);

    try {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: "❌ Ocurrió un error al procesar el comando.",
          ephemeral: true
        });
      } else if (interaction.deferred) {
        await interaction.editReply("❌ Ocurrió un error al procesar el comando.");
      }
    } catch (e) {
      console.error("Error al enviar mensaje de error:", e);
    }
  }
});

// ================== LOGIN ==================
console.log("Iniciando login… TOKEN presente?", !!env.TOKEN);

client
  .login(env.TOKEN)
  .then(() => console.log("✅ login() resolved"))
  .catch((e) => console.error("❌ login() failed:", e));
