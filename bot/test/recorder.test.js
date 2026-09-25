import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { performance } from "node:perf_hooks";
import { setTimeout as sleep } from "node:timers/promises";
import { MANIFEST, Recorder, safeName } from "../src/recorder.js";
import { readOgg } from "./helpers.js";

const ANA = "111111111111111111";
const BIA = "222222222222222222";
const BOT = "333333333333333333";

// Conexão de voz e VoiceWatcher de mentira, com o mesmo formato que o Recorder usa.
function fakeVoice() {
  const receiver = {
    speaking: new EventEmitter(),
    subscriptions: new Map(),
    subscribe(userId) {
      const s = new PassThrough({ objectMode: true });
      s.once("close", () => this.subscriptions.delete(userId));
      this.subscriptions.set(userId, s);
      return s;
    },
  };
  const conn = { state: { status: "ready" }, receiver };
  const members = new Map([
    [ANA, { displayName: "Ana: a Barda", user: { username: "ana", bot: false } }],
    [BIA, { displayName: "Bia", user: { username: "bia", bot: false } }],
    [BOT, { displayName: "Música", user: { username: "musica", bot: true } }],
  ]);
  const announced = [];
  const watcher = {
    voiceStatus: "ready",
    channelId: "444444444444444444",
    guild: { id: "555555555555555555", name: "Mesa", members: { cache: members } },
    connection: () => conn,
    channelInfo: () => ({ id: "444444444444444444", name: "Taverna" }),
    members: () => [{ id: ANA }, { id: BIA }],
    announce: async text => { announced.push(text); },
  };
  // Pacote chegando do Discord: o "start" vem antes, como no @discordjs/voice.
  const send = (userId, packet = Buffer.from([0xfc, 1, 2, 3])) => {
    receiver.speaking.emit("start", userId);
    receiver.subscriptions.get(userId)?.write(packet);
  };
  // Uma fala: um pacote de 20 ms a cada 20 ms, como chega do Discord.
  const talk = async (userId, n) => {
    for (let i = 0; i < n; i++) {
      send(userId);
      await sleep(20);
    }
  };
  return { conn, watcher, announced, send, talk };
}

test("safeName tira o que o Windows não aceita em nomes de arquivo", () => {
  assert.equal(safeName('Ana: a "Barda"?'), "Ana a Barda");
  assert.equal(safeName("  ...  "), "sem-nome");
  assert.equal(safeName("fim. "), "fim");
});

test("grava uma faixa alinhada por pessoa e o sessao.json", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "rec-"));
  try {
    const { watcher, announced, send, talk } = fakeVoice();
    const rec = new Recorder(watcher, { onChange() {} });
    const res = rec.start({ dir, exclude: [BIA], notify: true });
    const t0 = performance.now();
    assert.ok(res.ok, res.text);
    assert.equal(rec.start({ dir }).ok, false, "não grava duas vezes");

    // Ana fala 10 pacotes, pausa ~700 ms e fala mais 10; Bia (excluída) e o bot também falam.
    await sleep(200);
    const firstAt = (performance.now() - t0) / 1000; // a máquina pode demorar mais que 200 ms
    await talk(ANA, 10);
    send(BIA);
    send(BOT);
    await sleep(700);
    await talk(ANA, 10);
    assert.ok(rec.mark("combate").ok);
    await sleep(100);
    const st = rec.status();
    assert.equal(st.active, true);
    assert.deepEqual(st.tracks.map(t => t.id), [ANA]);

    const out = rec.stop("teste", { mix: false });
    assert.ok(out.ok);
    await out.notice;
    assert.equal(rec.active, false);
    assert.equal(announced.length, 2);

    const session = st.dir;
    const manifest = JSON.parse(readFileSync(path.join(session, MANIFEST), "utf8"));
    assert.equal(manifest.format, "foundry-listener-recording");
    assert.ok(manifest.endedAt);
    assert.equal(manifest.channels[0].name, "Taverna");
    assert.equal(manifest.tracks.length, 1);
    const track = manifest.tracks[0];
    assert.equal(track.userId, ANA);
    assert.match(track.file, /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}_Ana a Barda_1111\.ogg$/);
    assert.ok(track.file.startsWith(manifest.stamp + "_"), "faixa começa com a data da gravação");
    assert.ok(session.endsWith(`${manifest.stamp}_Taverna`));
    assert.equal(manifest.mix.file, `${manifest.stamp}_sessao-completa.ogg`);
    assert.equal(track.segments.length, 2, JSON.stringify(track.segments));
    assert.ok(Math.abs(track.firstAudioAt - firstAt) < 0.1, `firstAudioAt ${track.firstAudioAt}, esperado ~${firstAt}`);
    assert.ok(track.segments[1][0] > track.segments[0][1] + 0.4, "pausa entre as falas");
    assert.deepEqual(manifest.markers.map(m => m.label), ["combate"]);
    assert.equal(manifest.mix.status, "pending");

    // A faixa cobre a gravação inteira: silêncio + falas até o fim.
    const { packets, pages } = readOgg(readFileSync(path.join(session, track.file)));
    const seconds = pages.at(-1).granule / 48_000;
    assert.ok(Math.abs(seconds - manifest.duration) < 0.05, `faixa ${seconds}s, sessão ${manifest.duration}s`);
    assert.equal(packets.filter(p => p.length === 4).length, 20, "as 20 falas estão lá");
    assert.ok(!readdirSync(session).some(f => f.includes("Bia")), "Bia não foi gravada");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sem ffmpeg, o mix avisa e as faixas continuam lá", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "rec-"));
  const old = process.env.FFMPEG_PATH;
  process.env.FFMPEG_PATH = path.join(dir, "nao-existe", "ffmpeg.exe");
  try {
    const { watcher, send } = fakeVoice();
    const rec = new Recorder(watcher, { onChange() {} });
    rec.start({ dir, notify: false });
    send(ANA);
    const session = rec.status().dir;
    rec.stop("teste");
    for (let i = 0; i < 50 && rec.mix?.state === "running"; i++) await sleep(20);
    assert.equal(rec.mix.state, "no-ffmpeg");
    const manifest = JSON.parse(readFileSync(path.join(session, MANIFEST), "utf8"));
    assert.equal(manifest.mix.status, "no-ffmpeg");
    assert.equal(manifest.tracks.length, 1);
  } finally {
    if (old === undefined) delete process.env.FFMPEG_PATH;
    else process.env.FFMPEG_PATH = old;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("duas gravações no mesmo minuto não repetem nomes de arquivo", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "rec-"));
  try {
    const { conn, watcher, send } = fakeVoice();
    const rec = new Recorder(watcher, { onChange() {} });
    const names = [];
    for (let i = 0; i < 2; i++) {
      rec.start({ dir, notify: false });
      send(ANA);
      const session = rec.status().dir;
      rec.stop("teste", { mix: false });
      const manifest = JSON.parse(readFileSync(path.join(session, MANIFEST), "utf8"));
      names.push(path.basename(session), manifest.tracks[0].file, manifest.mix.file);
    }
    assert.equal(new Set(names).size, names.length, names.join(", "));

    // Recomeçar logo depois de parar: a assinatura nova sobrevive ao "close" atrasado da antiga.
    rec.start({ dir, notify: false });
    await sleep(50);
    // Fala contínua: sem novo "start", o pacote só chega se a assinatura ainda estiver no mapa.
    conn.receiver.subscriptions.get(ANA)?.write(Buffer.from([0xfc, 1, 2, 3]));
    assert.equal(rec.status().tracks.length, 1, "a voz chega na gravação nova");
    rec.stop("teste", { mix: false });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
