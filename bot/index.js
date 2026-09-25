import readline from "node:readline";
import { loadConfig } from "./src/config.js";
import { VoiceWatcher } from "./src/discord.js";
import { Recorder } from "./src/recorder.js";
import { startWsServer } from "./src/wsserver.js";
import { ipc, log, reportFatal, reportStatus } from "./src/report.js";

let cfg;
try {
  cfg = loadConfig();
} catch (err) {
  reportFatal("config", `Configuração incompleta: ${err.message}`);
  if (!ipc) log("info", "Copie .env.example para .env e preencha os campos.");
  process.exit(2);
}

const startedAt = Date.now();

const watcher = new VoiceWatcher(cfg, {
  onSpeaking(discordUserId, speaking) {
    server.broadcast({ type: "speaking", discordUserId, speaking, ts: Date.now() });
    status();
  },
  onChange() {
    recorder.sync();
    server.broadcast(foundryState());
    status();
  },
});

const recorder = new Recorder(watcher, { onChange: () => status() });

function foundryState() {
  const members = watcher.members();
  return {
    type: "state",
    channelId: watcher.channelId,
    channelName: watcher.channelInfo()?.name ?? null,
    members,
    speaking: members.filter(m => m.speaking).map(m => m.id),
    ts: Date.now(),
  };
}

function snapshot() {
  const user = watcher.client.user;
  return {
    startedAt,
    discord: watcher.ready ? (watcher.gatewayUp ? "online" : "reconnecting") : "connecting",
    ping: watcher.client.ws.ping >= 0 ? Math.round(watcher.client.ws.ping) : null,
    bot: user ? { tag: user.tag, id: user.id, avatar: user.displayAvatarURL({ size: 64, extension: "png" }) } : null,
    guild: watcher.guild ? { id: watcher.guild.id, name: watcher.guild.name } : null,
    guildMissing: watcher.ready && !watcher.guild,
    invite: watcher.inviteUrl(),
    voice: watcher.voiceStatus,
    channel: watcher.channelInfo(),
    members: watcher.members(),
    channels: watcher.voiceChannels(),
    gmInVoice: !!watcher.guild?.voiceStates.cache.get(cfg.gmId)?.channelId,
    wsPort: cfg.port,
    foundry: server ? server.clientInfo() : [],
    recording: recorder.status(),
  };
}

const status = () => reportStatus(snapshot);

const server = startWsServer({
  port: cfg.port,
  extraOrigins: cfg.extraOrigins,
  getState: foundryState,
  onClientsChange: () => status(),
});

// Ping do Discord muda devagar; manda o status de vez em quando para o app.
setInterval(status, 5_000).unref();

// Comandos do FoundryListener.exe pela entrada padrão, um JSON por linha.
if (ipc) {
  const rl = readline.createInterface({ input: process.stdin });
  rl.on("line", async line => {
    let cmd;
    try { cmd = JSON.parse(line); } catch { return; }
    if (cmd.cmd === "join") {
      const id = cmd.channelId || watcher.gmChannel();
      if (!id) return log("warn", "O GM não está em nenhum canal de voz. Escolha um canal.");
      const res = await watcher.join(id, "pedido pelo app");
      if (!res.ok) log("err", res.text);
    } else if (cmd.cmd === "leave") {
      watcher.leave("pedido pelo app");
    } else if (cmd.cmd === "status") {
      status();
    } else if (cmd.cmd === "record-start") {
      const res = recorder.start({
        dir: cmd.dir,
        exclude: Array.isArray(cmd.exclude) ? cmd.exclude.map(String) : [],
        notify: cmd.notify !== false,
      });
      if (!res.ok) log("err", res.text);
    } else if (cmd.cmd === "record-stop") {
      const res = recorder.stop("pedido pelo app");
      if (!res.ok) log("warn", res.text);
    } else if (cmd.cmd === "record-mark") {
      const res = recorder.mark(cmd.label);
      if (!res.ok) log("warn", res.text);
    } else if (cmd.cmd === "record-mix") {
      const res = recorder.mixSession(cmd.dir);
      if (!res.ok) log("warn", res.text);
    }
  });
  rl.on("close", () => shutdown("o app fechou"));
}

log("info", `Retratos Falantes: iniciando (Node ${process.versions.node})`);
status();

// Token errado não adianta repetir; falta de internet, sim.
let retryMs = 5_000;
function login() {
  watcher.login().catch(err => {
    const code = err?.code ?? "";
    if (code === "TokenInvalid" || err?.status === 401 || /invalid token/i.test(err?.message ?? "")) {
      reportFatal("token", "O Discord recusou o token. Gere um novo em Developer Portal → Bot → Reset Token.");
      process.exit(3);
    }
    if (code === "DisallowedIntents") {
      reportFatal("intents", "O Discord recusou as intents do bot.");
      process.exit(3);
    }
    log("warn", `Não consegui entrar no Discord (${err?.message ?? err}). Tentando de novo em ${retryMs / 1000} s.`);
    setTimeout(login, retryMs);
    retryMs = Math.min(retryMs * 2, 60_000);
  });
}
login();

let stopping = false;
async function shutdown(reason) {
  if (stopping) return;
  stopping = true;
  log("info", `Encerrando (${reason})…`);
  try { await recorder.shutdown(); } catch {}
  try { server.close(); } catch {}
  try { await watcher.destroy(); } catch {}
  process.exit(0);
}
process.on("SIGINT", () => shutdown("Ctrl+C"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("unhandledRejection", err => log("err", `Erro inesperado: ${err?.stack ?? err}`));
