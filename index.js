"use strict";

require("dotenv").config();

const http = require("http");
const { request } = require("undici");
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

  PORT: Number(process.env.PORT || 10000)
};

function requireEnv(keys) {
  const missing = keys.filter((k) => !env[k]);
  if (missing.length) {
    console.error("❌ FALTAN VARIABLES DE ENTORNO:", missing.join(", "));
    process.exit(1);
  }
}

requireEnv([
  "TOKEN",
  "GUILD_ID",
  "ROLE_WHITELIST",
  "ROLE_DENIED",
  "ROLE_WD_WHITELIST",
  "ROLE_WD_DENIED",
  "PUBLIC_CHANNEL",
  "LOG_CHANNEL",
  "WD_LOG_CHANNEL"
]);

const wdWebhook = env.WD_WEBHOOK_URL
  ? new WebhookClient({ url: env.WD_WEBHOOK_URL })
  : null;

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
    console.error("⏳ TIMEOUT: Pasaron 25s y el bot NO llegó a READY.");
  }
}, 25000);

// ================== TOKEN PREFLIGHT ==================
async function tokenPreflight() {
  try {
    const res = await request("https://discord.com/api/v10/users/@me", {
      method: "GET",
      headers: {
        Authorization: `Bot ${env.TOKEN}`
      }
    });

    const body = await res.body.text();
    console.log("✅ PRECHECK /users/@me status:", res.statusCode);
    console.log("✅ PRECHECK body:", body.slice(0, 200));
  } catch (e) {
    console.error("❌ PRECHECK fallo (HTTP a Discord):", e);
  }
}

// ================== COMMANDS ==================
function buildCommands() {
  const idOpt = (b) =>
    b.addStringOption((option) =>
      option.setName("id").setDescription("ID del usuario").setRequired(true)
    );

  return [
    idOpt(new SlashCommandBuilder().setName("wlpass").setDescription("Aprobar whitelist")),
    idOpt(new SlashCommandBuilder().setName("wldenied").setDescription("Denegar whitelist")),
    idOpt(new SlashCommandBuilder().setName("wdpass").setDescription("Aprobar WL Delictiva")),
    idOpt(new SlashCommandBuilder().setName("wddenied").setDescription("Denegar WL Delictiva"))
  ].map((c) => c.toJSON());
}

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(env.TOKEN);
  await rest.put(
    Routes.applicationGuildCommands(client.user.id, env.GUILD_ID),
    { body: buildCommands() }
  );
  console.log("✔️ Comandos registrados correctamente");
}

// ================== READY ==================
client.once("ready", async () => {
  readyFired = true;
  console.log("=========== READY ===========");
  console.log(`Bot: ${client.user.tag}`);
  await registerCommands();
});

// ================== LOGIN ==================
(async () => {
  await tokenPreflight();

  console.log("Iniciando login… TOKEN presente?", !!env.TOKEN);

  client
    .login(env.TOKEN)
    .then(() => console.log("✅ login() resolved"))
    .catch((e) => console.error("❌ login() failed:", e));
})();
