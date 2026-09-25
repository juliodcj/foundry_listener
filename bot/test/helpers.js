import assert from "node:assert/strict";
import { oggCrc } from "../src/ogg.js";

// Lê as páginas e remonta os pacotes de um arquivo Ogg.
export function readOgg(buf) {
  const pages = [];
  const packets = [];
  let partial = [];
  let pos = 0;
  while (pos < buf.length) {
    assert.equal(buf.toString("ascii", pos, pos + 4), "OggS", `página em ${pos}`);
    const nsegs = buf[pos + 26];
    const lacing = [...buf.subarray(pos + 27, pos + 27 + nsegs)];
    const bodyLen = lacing.reduce((a, b) => a + b, 0);
    const end = pos + 27 + nsegs + bodyLen;
    const page = Buffer.from(buf.subarray(pos, end));
    const crc = page.readUInt32LE(22);
    page.writeUInt32LE(0, 22);
    assert.equal(oggCrc(page), crc, "CRC da página");
    pages.push({ flags: buf[pos + 5], granule: Number(buf.readBigInt64LE(pos + 6)), seq: buf.readUInt32LE(pos + 18) });
    let off = pos + 27 + nsegs;
    for (const l of lacing) {
      partial.push(buf.subarray(off, off + l));
      off += l;
      if (l < 255) { packets.push(Buffer.concat(partial)); partial = []; }
    }
    pos = end;
  }
  return { pages, packets };
}
