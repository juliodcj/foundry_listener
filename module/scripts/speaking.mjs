import { getSetting } from "./const.mjs";

/**
 * Quem está na call e quem está falando, igual em todos os clientes.
 * Nada aqui vai para o banco de dados: é só estado em memória.
 *
 * "Falando" tem um atraso na saída (releaseMs) para o retrato não piscar
 * entre uma palavra e outra, e uma tolerância na entrada (startMs): som mais
 * curto que isso (clique, teclado, tosse) é ignorado.
 */
class SpeakingStore {
  constructor() {
    this.members = new Map();   // discordId → { id, name, username, avatar }
    this.channel = null;        // { id, name } ou null
    this.raw = new Set();       // falando agora, segundo o bot
    this.visible = new Set();   // falando para a barra (com atraso na saída)
    this.timers = new Map();    // discordId → timeout da saída
    this.starts = new Map();    // discordId → timeout da entrada (tolerância a ruído)
    this.bridgeConnected = false;
    this.listeners = new Set();
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  _emit(kind) {
    for (const fn of this.listeners) {
      try { fn(kind); } catch (err) { console.error("retratos-falantes |", err); }
    }
  }

  isSpeaking(discordId) {
    return !!discordId && this.visible.has(discordId);
  }

  get anyoneSpeaking() {
    return this.visible.size > 0;
  }

  setSpeaking(id, speaking) {
    if (!id) return;
    if (speaking) {
      clearTimeout(this.timers.get(id));
      this.timers.delete(id);
      this.raw.add(id);
      if (this.visible.has(id) || this.starts.has(id)) return;
      const show = () => {
        this.starts.delete(id);
        if (!this.raw.has(id) || this.visible.has(id)) return;
        this.visible.add(id);
        this._emit("speaking");
      };
      const tolerance = Number(getSetting("startMs")) || 0;
      if (tolerance <= 0) show();
      else this.starts.set(id, setTimeout(show, tolerance));
      return;
    }
    this.raw.delete(id);
    // Parou antes de passar da tolerância: era ruído, nem chega a aparecer.
    if (this.starts.has(id)) {
      clearTimeout(this.starts.get(id));
      this.starts.delete(id);
      return;
    }
    if (!this.visible.has(id) || this.timers.has(id)) return;
    const delay = Number(getSetting("releaseMs")) || 0;
    const release = () => {
      this.timers.delete(id);
      if (this.raw.has(id)) return;
      this.visible.delete(id);
      this._emit("speaking");
    };
    if (delay <= 0) release();
    else this.timers.set(id, setTimeout(release, delay));
  }

  setState({ channelId = null, channelName = null, members = [], speaking = [] }) {
    this.channel = channelId ? { id: channelId, name: channelName ?? "" } : null;
    this.members = new Map(members.map(m => [m.id, m]));
    const now = new Set(speaking);
    for (const id of [...this.raw]) if (!now.has(id)) this.setSpeaking(id, false);
    for (const id of now) this.setSpeaking(id, true);
    this._emit("state");
  }

  setBridge(connected) {
    if (this.bridgeConnected === connected) return;
    this.bridgeConnected = connected;
    this._emit("bridge");
  }

  clear() {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    for (const timer of this.starts.values()) clearTimeout(timer);
    this.starts.clear();
    this.raw.clear();
    this.visible.clear();
    this.members.clear();
    this.channel = null;
    this._emit("state");
  }

  snapshot() {
    return {
      channelId: this.channel?.id ?? null,
      channelName: this.channel?.name ?? null,
      members: [...this.members.values()],
      speaking: [...this.raw],
    };
  }
}

export const store = new SpeakingStore();
