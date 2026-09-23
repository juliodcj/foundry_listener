import { WebSocketServer } from "ws";
import { log } from "./report.js";

const HEARTBEAT_MS = 15_000;

// Só páginas abertas no próprio computador (o Foundry desktop em localhost)
// ou pelo túnel da Cloudflare podem conectar. Outras abas do navegador não.
function originAllowed(origin, extra) {
  if (!origin || origin === "null" || origin.startsWith("file://")) return true;
  if (extra.includes(origin)) return true;
  try {
    const { hostname } = new URL(origin);
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]"
      || hostname.endsWith(".trycloudflare.com");
  } catch {
    return false;
  }
}

/**
 * Servidor WebSocket local para o cliente do GM no Foundry.
 * getState() devolve a mensagem "state" atual, enviada a cada conexão nova.
 */
export function startWsServer({ port, extraOrigins, getState, onClientsChange }) {
  const clients = new Set();
  const wss = new WebSocketServer({
    host: "127.0.0.1",
    port,
    verifyClient: ({ origin }) => {
      const ok = originAllowed(origin, extraOrigins);
      if (!ok) log("warn", `Conexão recusada de origem desconhecida: ${origin}`);
      return ok;
    },
  });

  const changed = () => onClientsChange?.(clients.size);

  wss.on("listening", () => log("ok", `WebSocket ouvindo em ws://127.0.0.1:${port}`));
  wss.on("error", err => {
    if (err.code === "EADDRINUSE") {
      log("err", `A porta ${port} já está em uso. Feche a outra cópia do bot ou troque WS_PORT.`);
    } else {
      log("err", `Erro no WebSocket: ${err.message}`);
    }
    process.exitCode = 1;
    setTimeout(() => process.exit(1), 200);
  });

  wss.on("connection", (ws, req) => {
    ws.isAlive = true;
    ws.info = { origin: req.headers.origin ?? "", user: "", world: "" };
    clients.add(ws);
    log("ok", `Foundry conectado (${clients.size} conexão${clients.size === 1 ? "" : "ões"})`);
    changed();
    ws.send(JSON.stringify(getState()));

    ws.on("pong", () => { ws.isAlive = true; });
    ws.on("message", raw => {
      ws.isAlive = true;
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg?.type === "hello") {
        ws.info.user = String(msg.user ?? "").slice(0, 80);
        ws.info.world = String(msg.world ?? "").slice(0, 80);
        log("info", `Foundry identificado: ${ws.info.user || "?"} no mundo "${ws.info.world || "?"}"`);
        changed();
      } else if (msg?.type === "requestState") {
        ws.send(JSON.stringify(getState()));
      }
    });
    ws.on("close", () => {
      clients.delete(ws);
      log("warn", `Foundry desconectado (${clients.size} restante${clients.size === 1 ? "" : "s"})`);
      changed();
    });
    ws.on("error", () => {});
  });

  // Ping do protocolo derruba conexões mortas; o "ping" em JSON é o
  // heartbeat que o módulo usa para saber que o bot continua vivo.
  const beat = setInterval(() => {
    const ping = JSON.stringify({ type: "ping", ts: Date.now() });
    for (const ws of clients) {
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
      ws.send(ping);
    }
  }, HEARTBEAT_MS);
  wss.on("close", () => clearInterval(beat));

  return {
    broadcast(msg) {
      const data = JSON.stringify(msg);
      for (const ws of clients) if (ws.readyState === ws.OPEN) ws.send(data);
    },
    clientInfo() {
      return [...clients].map(ws => ({ ...ws.info }));
    },
    close() {
      for (const ws of clients) ws.terminate();
      wss.close();
    },
  };
}
