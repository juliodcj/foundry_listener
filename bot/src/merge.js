// Junta duas gravações que ficaram separadas (o bot caiu, alguém parou sem
// querer…) numa só: a segunda continua logo depois do fim da primeira.
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { OggOpusWriter, RATE, SILENCE_FRAME, opusPacketSamples, readOggPackets } from "./ogg.js";

const FRAME = 960;
const MERGED_SUFFIX = /_junta(?:_\d+)?$/;
export const ORIGINALS = "originais";

/**
 * Cria a gravação juntada numa pasta nova, ao lado das duas, e move as duas
 * originais para dentro dela (em "originais"). A ordem vem do startedAt.
 * Cada pessoa continua numa faixa só, todas alinhadas; quem só aparece numa
 * das partes fica em silêncio na outra. Os pacotes Opus são copiados como
 * estão, sem perder qualidade. Devolve a pasta nova e o sessao.json dela.
 */
export async function mergeRecordings(dirs, { manifestName, mixFileName, safeName, onProgress = () => {} }) {
  const parts = dirs.map(dir => {
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(path.join(dir, manifestName), "utf8"));
    } catch {
      throw new Error(`Não achei o ${manifestName} de ${path.basename(dir)}.`);
    }
    return { dir, folder: path.basename(dir), manifest };
  });
  parts.sort((a, b) => String(a.manifest.startedAt).localeCompare(String(b.manifest.startedAt)));
  const [A, B] = parts;
  const a = A.manifest;
  const b = B.manifest;

  const stamp = a.stamp ?? /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}(?:_\d+)?/.exec(A.folder)?.[0] ?? null;
  const root = path.dirname(A.dir);
  const base = `${A.folder.replace(MERGED_SUFFIX, "")}_junta`;
  let folder = base;
  for (let i = 2; existsSync(path.join(root, folder)); i++) folder = `${base}_${i}`;
  const outDir = path.join(root, folder);
  mkdirSync(outDir);

  try {
    // Uma entrada por pessoa, na ordem em que apareceram.
    const people = new Map();
    for (const [i, m] of [a, b].entries()) {
      for (const tr of m.tracks ?? []) {
        const key = tr.userId ?? `${tr.name}|${tr.file}`;
        const p = people.get(key) ?? { userId: tr.userId ?? null, parts: [null, null] };
        p.parts[i] = tr;
        p.name = tr.name ?? p.name; // vale o nome mais recente
        p.username = tr.username ?? p.username ?? null;
        people.set(key, p);
      }
    }

    // A segunda parte começa onde a primeira acaba (pela faixa mais longa,
    // caso o sessao.json tenha ficado para trás quando o PC caiu).
    const sources = [...people.values()].map(p => p.parts.map((tr, i) => tr && loadTrack([A, B][i].dir, tr.file)));
    const lenA = Math.max(Math.round((Number(a.duration) || 0) * RATE), ...sources.map(s => s[0]?.samples ?? 0));
    const offset = Math.ceil(lenA / FRAME) * FRAME;
    const offSec = offset / RATE;
    const total = offset + Math.max(Math.round((Number(b.duration) || 0) * RATE), ...sources.map(s => s[1]?.samples ?? 0));

    const files = new Set();
    const tracks = [];
    let done = 0;
    const work = sources.reduce((n, s) => n + (s[0]?.samples ?? 0) + (s[1]?.samples ?? 0), 0) || 1;
    let p = 0;
    for (const person of people.values()) {
      const [srcA, srcB] = sources[p++];
      const tail = person.userId ? `_${person.userId.slice(-4)}` : "";
      const fileBase = `${stamp ? `${stamp}_` : ""}${safeName(person.name ?? "sem-nome")}${tail}`;
      let file = `${fileBase}.ogg`;
      for (let i = 2; files.has(file.toLowerCase()); i++) file = `${fileBase}-${i}.ogg`;
      files.add(file.toLowerCase());

      const w = new OggOpusWriter(path.join(outDir, file), {
        channels: srcA?.channels ?? srcB?.channels ?? 2,
        tags: { TITLE: person.name ?? "" },
      });
      try {
        let written = 0;
        for (const [src, start] of [[srcA, 0], [srcB, offset]]) {
          written = pad(w, written, start);
          if (!src) continue;
          let n = 0;
          for (const packet of src.packets()) {
            const samples = opusPacketSamples(packet);
            if (!samples) continue;
            w.write(packet, samples);
            written += samples;
            done += samples;
            // Arquivos grandes: devolve a vez de tempos em tempos para o bot
            // continuar respondendo ao Discord.
            if (++n % 3000 === 0) {
              onProgress(done / work);
              await new Promise(r => setImmediate(r));
            }
          }
        }
        pad(w, written, total);
      } finally {
        w.close();
      }

      const [ta, tb] = person.parts;
      const segments = [
        ...(ta?.segments ?? []),
        ...(tb?.segments ?? []).map(([s, e]) => [round2(s + offSec), round2(e + offSec)]),
      ];
      tracks.push({
        userId: person.userId,
        name: person.name,
        username: person.username,
        file,
        firstAudioAt: ta?.firstAudioAt ?? (tb?.firstAudioAt != null ? round2(tb.firstAudioAt + offSec) : null),
        segments,
      });
    }

    const channels = [...(a.channels ?? [])];
    for (const c of b.channels ?? []) {
      if (c.id !== channels.at(-1)?.id) channels.push({ ...c, at: round2((Number(c.at) || 0) + offSec) });
    }
    const endA = a.endedAt ? Date.parse(a.endedAt) : Date.parse(a.startedAt) + lenA / RATE * 1000;
    const gapMin = Math.round((Date.parse(b.startedAt) - endA) / 60_000);
    const joinLabel = gapMin >= 1 ? `Gravação retomada (pausa de ${fmtGap(gapMin)})` : "Gravação retomada";
    const summary = (part, at) => (part.manifest.parts ?? [{
      folder: part.folder, startedAt: part.manifest.startedAt, endedAt: part.manifest.endedAt ?? null,
      duration: part.manifest.duration, at: 0,
    }]).map(x => ({ ...x, at: round2((Number(x.at) || 0) + at) }));

    const manifest = {
      format: "foundry-listener-recording",
      version: 1,
      stamp,
      startedAt: a.startedAt,
      endedAt: b.endedAt ?? new Date(Date.parse(b.startedAt) + (Number(b.duration) || 0) * 1000).toISOString(),
      duration: round2(total / RATE),
      sampleRate: RATE,
      guild: a.guild ?? b.guild ?? null,
      channels,
      tracks,
      markers: [
        ...(a.markers ?? []),
        { at: round2(offSec), label: joinLabel },
        ...(b.markers ?? []).map(m => ({ ...m, at: round2((Number(m.at) || 0) + offSec) })),
      ],
      parts: [...summary(A, 0), ...summary(B, offSec)],
      mix: tracks.length ? { file: mixFileName(stamp), status: "pending" } : null,
    };
    saveJson(path.join(outDir, manifestName), manifest);
    onProgress(1);

    // As originais vão para dentro da nova: somem da lista, mas não se perdem.
    const moved = [];
    for (const part of [A, B]) {
      try {
        mkdirSync(path.join(outDir, ORIGINALS), { recursive: true });
        renameSync(part.dir, path.join(outDir, ORIGINALS, part.folder));
        moved.push(part.folder);
      } catch {}
    }
    return { dir: outDir, folder, manifest, kept: [A, B].map(x => x.folder).filter(f => !moved.includes(f)) };
  } catch (err) {
    try { rmSync(outDir, { recursive: true, force: true }); } catch {}
    throw err;
  }
}

// Lê a faixa uma vez só para saber a duração; os pacotes são lidos de novo
// na hora de copiar, para não manter várias faixas inteiras na memória.
function loadTrack(dir, file) {
  const full = path.join(dir, file);
  let channels = 2;
  let samples = 0;
  try {
    let i = 0;
    for (const packet of readOggPackets(readFileSync(full))) {
      if (i++ < 2) {
        if (i === 1 && packet.toString("ascii", 0, 8) === "OpusHead") channels = packet[9] || 2;
        continue;
      }
      samples += opusPacketSamples(packet);
    }
  } catch {
    return null; // faixa listada mas que não existe mais: vira silêncio
  }
  return {
    channels,
    samples,
    *packets() {
      let k = 0;
      for (const packet of readOggPackets(readFileSync(full))) if (k++ >= 2) yield packet;
    },
  };
}

function pad(w, written, target) {
  while (written + FRAME <= target) {
    w.write(SILENCE_FRAME, FRAME);
    written += FRAME;
  }
  return written;
}

function saveJson(file, data) {
  writeFileSync(`${file}.tmp`, JSON.stringify(data, null, 2));
  renameSync(`${file}.tmp`, file);
}

function fmtGap(min) {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return min % 60 ? `${h} h ${min % 60} min` : `${h} h`;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}
