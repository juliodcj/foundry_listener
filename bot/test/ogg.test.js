import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { OggOpusWriter, SILENCE_FRAME, oggCrc, opusPacketSamples } from "../src/ogg.js";
import { readOgg } from "./helpers.js";

test("CRC do Ogg bate com o valor de referência", () => {
  assert.equal(oggCrc(Buffer.from("123456789")), 0x89a1897f);
});

test("duração dos pacotes Opus pelo TOC", () => {
  assert.equal(opusPacketSamples(SILENCE_FRAME), 960); // CELT 20 ms
  assert.equal(opusPacketSamples(Buffer.from([0x78, 0])), 960); // híbrido 20 ms
  assert.equal(opusPacketSamples(Buffer.from([0x08])), 960); // SILK 20 ms
  assert.equal(opusPacketSamples(Buffer.from([0x0b, 0x03])), 2880); // SILK 20 ms × 3
  assert.equal(opusPacketSamples(Buffer.from([0xf9])), 1920); // CELT 20 ms × 2
  assert.equal(opusPacketSamples(Buffer.alloc(0)), 0);
});

test("o arquivo é um Ogg Opus válido e guarda os pacotes intactos", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ogg-"));
  try {
    const file = path.join(dir, "a.ogg");
    const w = new OggOpusWriter(file, { tags: { TITLE: "Júlio" } });
    const sent = [];
    for (let i = 0; i < 400; i++) {
      // pacotes de tamanhos variados, alguns maiores que 255 bytes
      const p = Buffer.alloc(1 + (i * 37) % 600, i & 0xff);
      p[0] = 0xfc; // CELT 20 ms, estéreo
      w.write(p);
      sent.push(p);
    }
    w.close();
    const { pages, packets } = readOgg(readFileSync(file));
    assert.equal(pages[0].flags, 2, "primeira página com BOS");
    assert.equal(pages.at(-1).flags & 4, 4, "última página com EOS");
    assert.deepEqual(pages.map(p => p.seq), pages.map((_, i) => i));
    assert.equal(packets[0].toString("ascii", 0, 8), "OpusHead");
    assert.equal(packets[0][9], 2, "estéreo");
    assert.equal(packets[1].toString("ascii", 0, 8), "OpusTags");
    assert.ok(packets[1].includes(Buffer.from("TITLE=Júlio", "utf8")));
    assert.equal(packets.length, 2 + sent.length);
    packets.slice(2).forEach((p, i) => assert.ok(p.equals(sent[i]), `pacote ${i}`));
    assert.equal(pages.at(-1).granule, 400 * 960);
    assert.equal(w.bytes, readFileSync(file).length);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
