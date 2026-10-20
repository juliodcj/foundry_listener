import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { mergeRecordings } from "../src/merge.js";
import { OggOpusWriter, SILENCE_FRAME, readOggPackets } from "../src/ogg.js";
import { MANIFEST, mixFileName, safeName } from "../src/recorder.js";
import { readOgg } from "./helpers.js";

const ANA = "111111111111111111";
const BIA = "222222222222222222";
const opts = { manifestName: MANIFEST, mixFileName, safeName };

// Faixa com `frames` quadros de 20 ms; os de voz têm o byte `mark`.
function writeTrack(file, frames, mark) {
  const w = new OggOpusWriter(file);
  for (let i = 0; i < frames; i++) w.write(i % 2 ? SILENCE_FRAME : Buffer.from([0xfc, mark]), 960);
  w.close();
}

function session(root, folder, manifest, tracks) {
  const dir = path.join(root, folder);
  mkdirSync(dir);
  for (const [file, frames, mark] of tracks) writeTrack(path.join(dir, file), frames, mark);
  writeFileSync(path.join(dir, MANIFEST), JSON.stringify(manifest));
  return dir;
}

test("junta duas gravações: a segunda continua no fim da primeira", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "merge-"));
  try {
    // A: 2 s (100 quadros), Ana e Bia. B: 1 s (50 quadros), só Ana.
    const a = session(root, "2026-10-18_20-00_Taverna", {
      stamp: "2026-10-18_20-00", startedAt: "2026-10-18T23:00:00.000Z", endedAt: "2026-10-18T23:00:02.000Z",
      duration: 2, channels: [{ id: "c1", name: "Taverna", at: 0 }],
      tracks: [
        { userId: ANA, name: "Ana", file: "a-ana.ogg", firstAudioAt: 0, segments: [[0, 1]] },
        { userId: BIA, name: "Bia", file: "a-bia.ogg", firstAudioAt: 0.5, segments: [[0.5, 1.5]] },
      ],
      markers: [{ at: 1, label: "combate" }], mix: { file: "x.ogg", status: "ok" },
    }, [["a-ana.ogg", 100, 1], ["a-bia.ogg", 100, 2]]);
    const b = session(root, "2026-10-18_20-15_Taverna", {
      stamp: "2026-10-18_20-15", startedAt: "2026-10-18T23:15:00.000Z", endedAt: "2026-10-18T23:15:01.000Z",
      duration: 1, channels: [{ id: "c1", name: "Taverna", at: 0 }],
      tracks: [{ userId: ANA, name: "Ana (Barda)", file: "b-ana.ogg", firstAudioAt: 0.2, segments: [[0.2, 0.8]] }],
      markers: [{ at: 0.5, label: "fim" }], mix: null,
    }, [["b-ana.ogg", 50, 3]]);

    // A ordem vem do horário, não da ordem pedida.
    const res = await mergeRecordings([b, a], opts);
    assert.equal(res.folder, "2026-10-18_20-00_Taverna_junta");
    assert.deepEqual(res.kept, []);
    assert.ok(!existsSync(a) && !existsSync(b), "originais saíram da lista");
    assert.deepEqual(readdirSync(path.join(res.dir, "originais")).sort(), [path.basename(a), path.basename(b)]);

    const m = JSON.parse(readFileSync(path.join(res.dir, MANIFEST), "utf8"));
    assert.equal(m.duration, 3);
    assert.equal(m.startedAt, "2026-10-18T23:00:00.000Z");
    assert.equal(m.endedAt, "2026-10-18T23:15:01.000Z");
    assert.deepEqual(m.markers.map(x => [x.at, x.label]), [[1, "combate"], [2, "Gravação retomada (pausa de 15 min)"], [2.5, "fim"]]);
    assert.deepEqual(m.channels, [{ id: "c1", name: "Taverna", at: 0 }]);
    assert.deepEqual(m.mix, { file: "2026-10-18_20-00_sessao-completa.ogg", status: "pending" });
    assert.deepEqual(m.parts.map(p => [p.folder, p.at]), [[path.basename(a), 0], [path.basename(b), 2]]);

    const ana = m.tracks.find(t => t.userId === ANA);
    const bia = m.tracks.find(t => t.userId === BIA);
    assert.equal(ana.name, "Ana (Barda)", "vale o nome mais recente");
    assert.equal(ana.file, "2026-10-18_20-00_Ana (Barda)_1111.ogg");
    assert.deepEqual(ana.segments, [[0, 1], [2.2, 2.8]]);
    assert.deepEqual(bia.segments, [[0.5, 1.5]]);

    // Pacotes copiados como estavam; Bia fica em silêncio na segunda parte.
    const anaOgg = readOgg(readFileSync(path.join(res.dir, ana.file)));
    assert.equal(anaOgg.pages.at(-1).granule, 150 * 960);
    const anaAudio = anaOgg.packets.slice(2);
    assert.equal(anaAudio.length, 150);
    assert.deepEqual([anaAudio[0][1], anaAudio[100][1]], [1, 3]);
    const biaAudio = readOgg(readFileSync(path.join(res.dir, bia.file))).packets.slice(2);
    assert.equal(biaAudio.length, 150);
    assert.ok(biaAudio.slice(100).every(p => p.equals(SILENCE_FRAME)));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("gravação interrompida: a faixa mais longa que o sessao.json manda", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "merge-"));
  try {
    // O PC caiu: o sessao.json ficou em 0,5 s; a faixa tem 2 s gravados, mas a
    // segunda página ficou pela metade, então só o primeiro segundo vale.
    const a = session(root, "2026-10-18_20-00_Taverna", {
      startedAt: "2026-10-18T23:00:00.000Z", endedAt: null, duration: 0.5,
      tracks: [{ userId: ANA, name: "Ana", file: "a.ogg", segments: [] }], markers: [],
    }, [["a.ogg", 100, 1]]);
    const file = path.join(a, "a.ogg");
    const buf = readFileSync(file);
    writeFileSync(file, buf.subarray(0, buf.length - 40));
    const b = session(root, "2026-10-18_20-05_Taverna", {
      startedAt: "2026-10-18T23:05:00.000Z", endedAt: "2026-10-18T23:05:01.000Z", duration: 1,
      tracks: [{ userId: ANA, name: "Ana", file: "b.ogg", segments: [[0, 1]] }], markers: [],
    }, [["b.ogg", 50, 3]]);

    const res = await mergeRecordings([a, b], opts);
    const m = JSON.parse(readFileSync(path.join(res.dir, MANIFEST), "utf8"));
    assert.equal(m.markers[0].at, 1, "emenda depois da última página inteira");
    assert.deepEqual(m.tracks[0].segments, [[1, 2]]);
    const packets = [...readOggPackets(readFileSync(path.join(res.dir, m.tracks[0].file)))].slice(2);
    assert.equal(packets.length, 100);
    assert.deepEqual([packets[0][1], packets[50][1]], [1, 3]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("uma pasta sem sessao.json não é juntada nem deixa pasta nova", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "merge-"));
  try {
    const a = session(root, "a", { startedAt: "2026-10-18T23:00:00.000Z", duration: 0, tracks: [], markers: [] }, []);
    mkdirSync(path.join(root, "b"));
    await assert.rejects(mergeRecordings([a, path.join(root, "b")], opts), /sessao\.json/);
    assert.deepEqual(readdirSync(root).sort(), ["a", "b"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
