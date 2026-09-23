import { MODULE_ID, getSetting, t } from "./const.mjs";
import { store } from "./speaking.mjs";
import { emit } from "./socket.mjs";

const MAX_BACKOFF_MS = 15_000;
// O bot manda "ping" a cada 15 s; sem nada por 40 s, a conexão está morta.
const SILENCE_TIMEOUT_MS = 40_000;

/**
 * Ponte entre o bot local e o Foundry. Só roda no GM ativo
 * (game.users.activeGM), que é quem está na mesma máquina do bot.
 */
export class Bridge {
  constructor() {
    this.ws = null;
    this.active = false;
    this.backoff = 1_000;
    this.retryTimer = null;
    this.silenceTimer = null;
    this.everConnected = false;
    this.warned = false;
  }

  get url() {
    return `ws://127.0.0.1:${Number(getSetting("wsPort")) || 8770}`;
  }

  /** Liga ou desliga conforme este cliente for (ou não) o GM ativo. */
  sync() {
    const shouldRun = game.user.isGM && game.users.activeGM?.id === game.user.id;
    if (shouldRun && !this.active) this.start();
    else if (!shouldRun && this.active) this.stop();
  }

  start() {
    this.active = true;
    this.backoff = 1_000;
    this.connect();
  }

  stop() {
    this.active = false;
    clearTimeout(this.retryTimer);
    clearTimeout(this.silenceTimer);
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onclose = null;
      ws.close();
    }
    store.setBridge(false);
  }

  restart() {
    this.stop();
    this.sync();
  }

  connect() {
    if (!this.active) return;
    clearTimeout(this.retryTimer);
    let ws;
    try {
      ws = new WebSocket(this.url);
    } catch (err) {
      console.warn(`${MODULE_ID} | WebSocket inválido`, err);
      this._scheduleRetry();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.backoff = 1_000;
      this.everConnected = true;
      this.warned = false;
      store.setBridge(true);
      this._touch();
      ws.send(JSON.stringify({ type: "hello", user: game.user.name, world: game.world.title }));
      console.log(`${MODULE_ID} | conectado ao bot em ${this.url}`);
    };

    ws.onmessage = event => {
      this._touch();
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }
      this._handle(msg);
    };

    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      clearTimeout(this.silenceTimer);
      const was = store.bridgeConnected;
      store.setBridge(false);
      // Sem bot, ninguém está falando: limpa a barra em todo mundo.
      if (was) {
        store.clear();
        emit({ type: "clear" });
        if (!this.warned) {
          this.warned = true;
          ui.notifications.warn(t("Bridge.Lost"));
        }
      }
      this._scheduleRetry();
    };

    ws.onerror = () => {}; // o onclose cuida da reconexão
  }

  _scheduleRetry() {
    if (!this.active) return;
    clearTimeout(this.retryTimer);
    const wait = this.backoff;
    this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS);
    this.retryTimer = setTimeout(() => this.connect(), wait);
  }

  _touch() {
    clearTimeout(this.silenceTimer);
    this.silenceTimer = setTimeout(() => {
      console.warn(`${MODULE_ID} | bot sem responder; reconectando`);
      this.ws?.close();
    }, SILENCE_TIMEOUT_MS);
  }

  _handle(msg) {
    switch (msg?.type) {
      case "state": {
        const payload = {
          channelId: msg.channelId ?? null,
          channelName: msg.channelName ?? null,
          members: (msg.members ?? []).map(m => ({
            id: String(m.id), name: String(m.name ?? ""), username: String(m.username ?? ""), avatar: String(m.avatar ?? ""),
          })),
          speaking: (msg.speaking ?? []).map(String),
        };
        store.setState(payload);
        emit({ type: "state", ...payload });
        break;
      }
      case "speaking": {
        const id = String(msg.discordUserId ?? "");
        if (!id) return;
        store.setSpeaking(id, !!msg.speaking);
        emit({ type: "speaking", id, speaking: !!msg.speaking });
        break;
      }
      case "ping":
        this.ws?.send(JSON.stringify({ type: "pong", ts: msg.ts }));
        break;
    }
  }
}

export const bridge = new Bridge();
