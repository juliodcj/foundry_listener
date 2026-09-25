import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import path from "node:path";
import { EndBehaviorType } from "@discordjs/voice";
import { OggOpusWriter, RATE, SILENCE_FRAME, opusPacketSamples } from "./ogg.js";
import { log } from "./report.js";

export const MANIFEST = "sessao.json";
// Nome do mix antes de os arquivos levarem a data da gravação.
export const OLD_MIX_FILE = "sessao-completa.ogg";

const FRAME = 960; // 20 ms
// Sem pacotes por mais que isso, a próxima fala é realinhada ao relógio
// (mesmo tempo que o @discordjs/voice usa para "parou de falar").
const NEW_BURST_MS = 100;
// Pausas maiores que isso separam dois trechos de fala no sessao.json.
const NEW_SEGMENT_MS = 500;
// Pacotes perdidos no meio de uma fala longa: realinha se atrasar mais que isso.
const MAX_DRIFT = RATE / 5;

/**
 * Grava a call: uma faixa .ogg por pessoa, todas começando no início da
 * gravação (com silêncio onde a pessoa não fala), mais o sessao.json com os
 * trechos de fala e os marcadores. Ao parar, mixa tudo com o ffmpeg.
 */
export class Recorder {
  constructor(watcher, { onChange }) {
    this.watcher = watcher;
    this.onChange = onChange;
    this.session = null;
    this.last = null; // última gravação encerrada
    this.mix = null; // mix em andamento ou o último feito
    this.mixProc = null;
    this.timer = null;
  }

  get active() {
    return !!this.session;
  }

  start({ dir, exclude = [], notify = true }) {
    if (this.session) return { ok: false, text: "Já estou gravando." };
    const w = this.watcher;
    const connection = w.connection();
    if (!connection || w.voiceStatus !== "ready") return { ok: false, text: "O bot precisa estar numa call para gravar." };
    if (!dir || !path.isAbsolute(dir)) return { ok: false, text: "A pasta das gravações não é válida." };

    const startedAt = new Date();
    // Data e hora da gravação no começo da pasta e de cada arquivo, para que
    // arquivos de sessões diferentes nunca tenham o mesmo nome.
    const channelName = safeName(w.channelInfo()?.name ?? "call");
    let stamp = stampName(startedAt);
    for (let i = 2; existsSync(path.join(dir, `${stamp}_${channelName}`)); i++) stamp = `${stampName(startedAt)}_${i}`;
    const folder = `${stamp}_${channelName}`;
    const sessionDir = path.join(dir, folder);
    try {
      mkdirSync(sessionDir, { recursive: true });
    } catch (err) {
      return { ok: false, text: `Não consegui criar a pasta da gravação: ${err.message}` };
    }

    const s = {
      dir: sessionDir,
      folder,
      stamp,
      startedAt,
      t0: performance.now(),
      exclude: new Set(exclude),
      notify,
      guild: w.guild ? { id: w.guild.id, name: w.guild.name } : null,
      tracks: new Map(),
      files: new Set(),
      markers: [],
      channels: [],
      listeners: new Map(),
      streams: new Set(),
      streamErrors: new Map(),
      dirty: true,
    };
    this.session = s;
    this.sync();
    try {
      saveManifest(s.dir, manifestOf(s));
    } catch (err) {
      this.session = null;
      this._detach(s);
      return { ok: false, text: `Não consegui escrever na pasta da gravação: ${err.message}` };
    }
    this.timer = setInterval(() => this._tick(), 2_000);
    this.timer.unref();
    log("ok", `Gravação iniciada em ${sessionDir}`);
    if (notify) w.announce("🔴 **Gravação iniciada.** Tudo o que for falado nesta call está sendo gravado.");
    this.onChange();
    return { ok: true, text: "Gravando." };
  }

  /** Acompanha a conexão e o canal do bot; chamado a cada mudança do VoiceWatcher. */
  sync() {
    const s = this.session;
    if (!s) return;
    for (const conn of s.listeners.keys()) {
      if (conn.state.status === "destroyed") s.listeners.delete(conn);
    }
    const conn = this.watcher.connection();
    if (conn && conn.state.status !== "destroyed" && !s.listeners.has(conn)) {
      const onStart = userId => this._subscribe(conn, userId);
      conn.receiver.speaking.on("start", onStart);
      s.listeners.set(conn, onStart);
      for (const m of this.watcher.members()) this._subscribe(conn, m.id);
    }
    const channel = this.watcher.channelInfo();
    const prev = s.channels.at(-1);
    if (channel && channel.id !== prev?.id) {
      s.channels.push({ id: channel.id, name: channel.name, at: round2(this._elapsed(s) / RATE) });
      s.dirty = true;
      if (prev) {
        log("info", `A gravação continua em "${channel.name}".`);
        if (s.notify) this.watcher.announce("🔴 **Esta call está sendo gravada.**");
      }
    }
  }

  mark(label) {
    const s = this.session;
    if (!s) return { ok: false, text: "Não estou gravando." };
    const at = round2(this._elapsed(s) / RATE);
    const text = String(label ?? "").trim().slice(0, 200) || `Marcador ${s.markers.length + 1}`;
    s.markers.push({ at, label: text });
    s.dirty = true;
    log("info", `Marcador em ${fmtClock(at)}: ${text}`);
    this.onChange();
    return { ok: true, text };
  }

  /**
   * Encerra a gravação. Com `mix`, gera o sessao-completa.ogg em seguida.
   * Devolve a promessa do aviso no Discord (para quem quiser esperar por ele).
   */
  stop(reason, { mix = true } = {}) {
    const s = this.session;
    if (!s) return { ok: false, text: "Não estou gravando." };
    this.session = null;
    clearInterval(this.timer);
    this.timer = null;
    this._detach(s);

    const endedAt = new Date();
    const end = this._elapsed(s);
    for (const tr of s.tracks.values()) {
      try {
        padTo(tr, end);
        closeSegment(tr);
        tr.writer.close();
      } catch (err) {
        log("err", `Falha ao fechar a faixa de ${tr.name}: ${err.message}`);
      }
    }
    const manifest = manifestOf(s, { endedAt, end });
    const willMix = mix && s.tracks.size > 0;
    if (willMix) manifest.mix = { file: mixFileName(s.stamp), status: "running" };
    else if (s.tracks.size) manifest.mix = { file: mixFileName(s.stamp), status: "pending" };
    try {
      saveManifest(s.dir, manifest);
    } catch (err) {
      log("err", `Falha ao salvar o ${MANIFEST}: ${err.message}`);
    }

    this.last = { dir: s.dir, folder: s.folder, duration: manifest.duration, tracks: s.tracks.size };
    log("ok", `Gravação encerrada (${reason}): ${fmtClock(manifest.duration)}, ${s.tracks.size} faixa(s).`);
    if (!s.tracks.size) log("warn", "Ninguém falou durante a gravação; nenhuma faixa foi criada.");
    const notice = s.notify
      ? this.watcher.announce(`⏹️ **Gravação encerrada** (${fmtClock(manifest.duration)}).`)
      : Promise.resolve();
    if (willMix) this.mixSession(s.dir);
    this.onChange();
    return { ok: true, text: "Gravação encerrada.", notice };
  }

  /** Mixa as faixas de uma gravação no sessao-completa.ogg, com o ffmpeg. */
  mixSession(dir) {
    if (this.mixProc) return { ok: false, text: "Já estou mixando outra gravação." };
    if (this.session?.dir === dir) return { ok: false, text: "Essa gravação ainda está em andamento." };
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(path.join(dir, MANIFEST), "utf8"));
    } catch {
      return { ok: false, text: "Não achei o sessao.json dessa gravação." };
    }
    const files = (manifest.tracks ?? []).map(t => path.join(dir, t.file)).filter(f => existsSync(f));
    if (!files.length) return { ok: false, text: "Essa gravação não tem faixas para mixar." };

    const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
    const mixFile = manifest.mix?.file || mixFileName(manifest.stamp ?? stampOfFolder(path.basename(dir)));
    const tmp = path.join(dir, mixFile.replace(/\.ogg$/i, "") + ".tmp.ogg");
    const out = path.join(dir, mixFile);
    const args = ["-hide_banner", "-nostdin", "-y"];
    for (const f of files) args.push("-i", f);
    // As faixas já estão alinhadas (todas começam no início da gravação):
    // basta somar, sem baixar o volume de cada uma.
    args.push(
      "-filter_complex", `amix=inputs=${files.length}:duration=longest:normalize=0`,
      "-ac", "2", "-c:a", "libopus", "-b:a", "96k", tmp,
    );

    const duration = Number(manifest.duration) || 0;
    const mix = { dir, folder: path.basename(dir), state: "running", progress: 0, error: null };
    this.mix = mix;
    setMixStatus(dir, mixFile, "running");
    log("info", `Mixando ${files.length} faixa(s) em ${mixFile}…`);

    let done = false;
    let lastLine = "";
    const finish = (state, error) => {
      if (done) return;
      done = true;
      this.mixProc = null;
      mix.state = state;
      mix.error = error ?? null;
      if (state === "ok") {
        mix.progress = 1;
        log("ok", `Mix pronto: ${out}`);
      } else {
        try { rmSync(tmp, { force: true }); } catch {}
        if (state === "no-ffmpeg") log("warn", "ffmpeg não encontrado: as faixas foram salvas, mas sem o arquivo mixado. Instale com \"winget install Gyan.FFmpeg\", reinicie o bot e use \"Gerar mix\".");
        else log("err", `O mix falhou: ${error}`);
      }
      setMixStatus(dir, mixFile, state, error);
      this.onChange();
    };

    let proc;
    try {
      proc = spawn(ffmpeg, args, { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    } catch (err) {
      finish(err.code === "ENOENT" ? "no-ffmpeg" : "failed", err.message);
      return { ok: false, text: mix.error };
    }
    this.mixProc = proc;
    proc.stderr.setEncoding("utf8");
    proc.stderr.on("data", chunk => {
      const times = [...chunk.matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)];
      const t = times.at(-1);
      if (t && duration > 0) {
        mix.progress = Math.min(0.99, (Number(t[1]) * 3600 + Number(t[2]) * 60 + Number(t[3])) / duration);
        this.onChange();
      }
      for (const line of chunk.split(/[\r\n]+/)) {
        if (line.trim() && !/^\s*size=/.test(line)) lastLine = line.trim();
      }
    });
    proc.on("error", err => finish(err.code === "ENOENT" ? "no-ffmpeg" : "failed", err.message));
    proc.on("close", code => {
      if (code !== 0) return finish("failed", lastLine || `ffmpeg saiu com código ${code}`);
      try {
        renameSync(tmp, out);
        finish("ok");
      } catch (err) {
        finish("failed", err.message);
      }
    });
    return { ok: true, text: "Mixando." };
  }

  /** Bot encerrando: fecha a gravação (sem mix) e para um mix pela metade. */
  async shutdown() {
    const res = this.stop("o bot foi encerrado", { mix: false });
    if (this.mixProc) {
      this.mixProc.kill();
    }
    if (res.ok) await Promise.race([res.notice, new Promise(r => setTimeout(r, 800))]);
  }

  status() {
    const s = this.session;
    return {
      active: !!s,
      startedAt: s ? s.startedAt.getTime() : null,
      dir: s?.dir ?? null,
      folder: s?.folder ?? null,
      bytes: s ? [...s.tracks.values()].reduce((n, tr) => n + tr.writer.bytes, 0) : 0,
      tracks: s ? [...s.tracks.values()].map(tr => ({ id: tr.userId, name: tr.name, bytes: tr.writer.bytes })) : [],
      markers: s?.markers.length ?? 0,
      last: this.last,
      mix: this.mix,
    };
  }

  // ---- internos -----------------------------------------------------------

  _elapsed(s) {
    return Math.round((performance.now() - s.t0) * RATE / 1000);
  }

  _subscribe(conn, userId) {
    const s = this.session;
    if (!s || s.exclude.has(userId) || !s.listeners.has(conn)) return;
    if (conn.state.status === "destroyed") return;
    // Assinatura de uma gravação que acabou de parar: a biblioteca só a tira
    // do mapa no próximo ciclo, e subscribe() a devolveria já fechada.
    const old = conn.receiver.subscriptions.get(userId);
    if (old?.destroyed) {
      // Sem isto, o "close" atrasado dela apagaria do mapa a assinatura nova.
      old.removeAllListeners("close");
      conn.receiver.subscriptions.delete(userId);
    } else if (old) return;
    if (this.watcher.guild?.members.cache.get(userId)?.user.bot) return;
    const stream = conn.receiver.subscribe(userId, { end: { behavior: EndBehaviorType.Manual } });
    s.streams.add(stream);
    stream.on("data", packet => this._packet(s, userId, packet));
    stream.on("error", err => {
      // Pacote que não deu para decriptar: a biblioteca fecha o stream.
      const lastAt = s.streamErrors.get(userId) ?? 0;
      if (Date.now() - lastAt > 60_000) {
        s.streamErrors.set(userId, Date.now());
        log("warn", `Falha ao receber o áudio de ${this._name(userId)}: ${err.message}`);
      }
    });
    stream.once("close", () => {
      s.streams.delete(stream);
      if (this.session === s) setImmediate(() => this._subscribe(conn, userId));
    });
  }

  _packet(s, userId, packet) {
    if (this.session !== s) return;
    // Quadro ainda com a criptografia de ponta a ponta (DAVE termina em 0xFAFA):
    // aparece em trocas de chave; vale mais pular do que gravar ruído.
    if (packet.length > 3 && packet[packet.length - 1] === 0xfa && packet[packet.length - 2] === 0xfa) return;
    // Alguns servidores de voz do Discord mandam pacotes só com zeros (o Craig também os descarta).
    if (packet[0] === 0 && packet.reduce((n, b) => n + (b === 0), 0) >= packet.length - 1) return;
    const samples = opusPacketSamples(packet);
    if (!samples) return;
    try {
      const tr = s.tracks.get(userId) ?? this._newTrack(s, userId);
      const t = performance.now();
      const target = Math.round((t - s.t0) * RATE / 1000) - samples;
      const gap = tr.lastAt ? t - tr.lastAt : Infinity;
      if (gap > NEW_BURST_MS || target - tr.written > MAX_DRIFT) padTo(tr, target);
      if (gap > NEW_SEGMENT_MS) {
        closeSegment(tr);
        tr.segStart = tr.written;
        if (tr.firstAudioAt == null) tr.firstAudioAt = round2(tr.written / RATE);
      }
      tr.writer.write(packet, samples);
      tr.written += samples;
      tr.segEnd = tr.written;
      tr.lastAt = t;
      s.dirty = true;
    } catch (err) {
      log("err", `Falha ao gravar no disco: ${err.message}`);
      this.stop("erro ao gravar no disco", { mix: false });
    }
  }

  _newTrack(s, userId) {
    const member = this.watcher.guild?.members.cache.get(userId);
    const name = member?.displayName ?? userId;
    const base = `${s.stamp}_${safeName(name)}_${userId.slice(-4)}`;
    let file = `${base}.ogg`;
    for (let i = 2; s.files.has(file.toLowerCase()); i++) file = `${base}-${i}.ogg`;
    s.files.add(file.toLowerCase());
    const tr = {
      userId,
      name,
      username: member?.user.username ?? null,
      file,
      writer: new OggOpusWriter(path.join(s.dir, file), { tags: { TITLE: name } }),
      written: 0,
      lastAt: 0,
      segStart: null,
      segEnd: 0,
      segments: [],
      firstAudioAt: null,
    };
    s.tracks.set(userId, tr);
    log("info", `Gravando a voz de ${name}.`);
    this.onChange();
    return tr;
  }

  _detach(s) {
    for (const [conn, onStart] of s.listeners) conn.receiver.speaking.off("start", onStart);
    s.listeners.clear();
    for (const stream of s.streams) {
      stream.removeAllListeners("data");
      stream.destroy();
    }
    s.streams.clear();
  }

  _tick() {
    const s = this.session;
    if (!s) return;
    try {
      // Grava as páginas pendentes: se o PC cair, o áudio até aqui fica tocável.
      for (const tr of s.tracks.values()) tr.writer.flush();
      if (s.dirty) {
        s.dirty = false;
        saveManifest(s.dir, manifestOf(s));
      }
    } catch (err) {
      log("err", `Falha ao gravar no disco: ${err.message}`);
      this.stop("erro ao gravar no disco", { mix: false });
      return;
    }
    this.onChange();
  }

  _name(userId) {
    return this.watcher.guild?.members.cache.get(userId)?.displayName ?? userId;
  }
}

// ---- arquivos -------------------------------------------------------------

function padTo(tr, target) {
  while (tr.written + FRAME <= target) {
    tr.writer.write(SILENCE_FRAME, FRAME);
    tr.written += FRAME;
  }
}

function closeSegment(tr) {
  if (tr.segStart != null && tr.segEnd > tr.segStart) tr.segments.push([tr.segStart, tr.segEnd]);
  tr.segStart = null;
}

function manifestOf(s, { endedAt = null, end = null } = {}) {
  const now = end ?? Math.round((performance.now() - s.t0) * RATE / 1000);
  return {
    format: "foundry-listener-recording",
    version: 1,
    stamp: s.stamp,
    startedAt: s.startedAt.toISOString(),
    endedAt: endedAt ? endedAt.toISOString() : null,
    duration: round2(now / RATE),
    sampleRate: RATE,
    guild: s.guild,
    channels: s.channels,
    tracks: [...s.tracks.values()].map(tr => {
      const segments = [...tr.segments];
      if (tr.segStart != null && tr.segEnd > tr.segStart) segments.push([tr.segStart, tr.segEnd]);
      return {
        userId: tr.userId,
        name: tr.name,
        username: tr.username,
        file: tr.file,
        firstAudioAt: tr.firstAudioAt,
        segments: segments.map(([a, b]) => [round2(a / RATE), round2(b / RATE)]),
      };
    }),
    markers: s.markers,
    mix: null,
  };
}

function saveManifest(dir, manifest) {
  const file = path.join(dir, MANIFEST);
  writeFileSync(`${file}.tmp`, JSON.stringify(manifest, null, 2));
  renameSync(`${file}.tmp`, file);
}

function setMixStatus(dir, file, status, error) {
  try {
    const manifest = JSON.parse(readFileSync(path.join(dir, MANIFEST), "utf8"));
    manifest.mix = { file, status };
    if (error) manifest.mix.error = String(error);
    saveManifest(dir, manifest);
  } catch {}
}

// ---- nomes ------------------------------------------------------------------

export function safeName(name) {
  const clean = String(name)
    .normalize("NFC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, "")
    .slice(0, 40)
    .trim();
  return clean || "sem-nome";
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

export function mixFileName(stamp) {
  return stamp ? `${stamp}_sessao-completa.ogg` : OLD_MIX_FILE;
}

// "2026-09-24_21-30" (ou "2026-09-24_21-30_2") do começo do nome da pasta.
function stampOfFolder(folder) {
  return /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}(?:_\d+)?(?=_|$)/.exec(folder)?.[0] ?? null;
}

function stampName(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}_${pad2(d.getHours())}-${pad2(d.getMinutes())}`;
}

export function fmtClock(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  return `${pad2(Math.floor(s / 3600))}:${pad2(Math.floor(s / 60) % 60)}:${pad2(s % 60)}`;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}
