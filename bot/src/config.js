import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// Variáveis já definidas (por exemplo, pelo FoundryListener.exe) têm prioridade sobre o .env.
loadEnv({ path: path.join(root, ".env"), quiet: true });

const snowflake = /^\d{17,20}$/;

function readId(name, { required }) {
  const value = (process.env[name] ?? "").trim();
  if (!value) {
    if (required) throw new Error(`${name} não foi preenchido.`);
    return null;
  }
  if (!snowflake.test(value)) throw new Error(`${name} não parece um ID do Discord: "${value}".`);
  return value;
}

export function loadConfig() {
  const token = (process.env.DISCORD_TOKEN ?? "").trim();
  if (!token) throw new Error("DISCORD_TOKEN não foi preenchido.");
  const port = Number((process.env.WS_PORT ?? "8770").trim() || 8770);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`WS_PORT inválida: "${process.env.WS_PORT}".`);
  }
  const extraOrigins = (process.env.WS_ALLOWED_ORIGINS ?? "")
    .split(",").map(s => s.trim()).filter(Boolean);
  return {
    token,
    guildId: readId("GUILD_ID", { required: true }),
    gmId: readId("GM_DISCORD_ID", { required: true }),
    voiceChannelId: readId("VOICE_CHANNEL_ID", { required: false }),
    port,
    extraOrigins,
    ipc: process.env.FOUNDRY_LISTENER_IPC === "1",
  };
}
