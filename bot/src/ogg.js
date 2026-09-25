// Escreve pacotes Opus do Discord num arquivo .ogg (Ogg Opus, RFC 7845) sem
// decodificar nada: os pacotes vão para o arquivo como chegaram.
import { closeSync, openSync, writeSync } from "node:fs";
import { randomInt } from "node:crypto";

export const RATE = 48_000;

// Quadro Opus de silêncio (20 ms) que o próprio Discord usa.
export const SILENCE_FRAME = Buffer.from([0xf8, 0xff, 0xfe]);

const BOS = 2;
const EOS = 4;
const PAGE_SAMPLES = RATE; // fecha uma página a cada ~1 s de áudio

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let r = i << 24;
    for (let j = 0; j < 8; j++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1;
    t[i] = r >>> 0;
  }
  return t;
})();

export function oggCrc(buf) {
  let crc = 0;
  for (const b of buf) crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ b) & 0xff]) >>> 0;
  return crc;
}

// Duração de um pacote Opus em amostras de 48 kHz, lida do byte TOC.
export function opusPacketSamples(packet) {
  if (!packet?.length) return 0;
  const toc = packet[0];
  const config = toc >> 3;
  let frame;
  if (config < 12) frame = [480, 960, 1920, 2880][config & 3]; // SILK 10/20/40/60 ms
  else if (config < 16) frame = config & 1 ? 960 : 480; // híbrido 10/20 ms
  else frame = [120, 240, 480, 960][config & 3]; // CELT 2,5/5/10/20 ms
  const code = toc & 3;
  let count = code === 0 ? 1 : code < 3 ? 2 : (packet[1] ?? 0) & 0x3f;
  return Math.min(frame * count, 5760);
}

function lacingFor(len) {
  return Math.floor(len / 255) + 1;
}

function buildPage(packets, { granule, serial, seq, flags }) {
  const lacing = [];
  for (const p of packets) {
    let n = p.length;
    while (n >= 255) { lacing.push(255); n -= 255; }
    lacing.push(n);
  }
  const header = Buffer.alloc(27 + lacing.length);
  header.write("OggS", 0, "ascii");
  header[4] = 0;
  header[5] = flags;
  header.writeBigInt64LE(BigInt(granule), 6);
  header.writeUInt32LE(serial, 14);
  header.writeUInt32LE(seq, 18);
  header[26] = lacing.length;
  lacing.forEach((v, i) => { header[27 + i] = v; });
  const page = Buffer.concat([header, ...packets]);
  page.writeUInt32LE(oggCrc(page), 22);
  return page;
}

export class OggOpusWriter {
  /**
   * @param {string} file
   * @param {{ channels?: number, tags?: Record<string, string> }} [opts]
   */
  constructor(file, { channels = 2, tags = {} } = {}) {
    this.fd = openSync(file, "w");
    this.serial = randomInt(0, 0xffffffff);
    this.seq = 0;
    this.granule = 0;
    this.bytes = 0;
    this.pending = [];
    this.pendingSegs = 0;
    this.pendingSamples = 0;

    const head = Buffer.alloc(19);
    head.write("OpusHead", 0, "ascii");
    head[8] = 1; // versão
    head[9] = channels;
    head.writeUInt16LE(0, 10); // pre-skip: os pacotes vêm do Discord, sem atraso de encoder
    head.writeUInt32LE(RATE, 12);
    head.writeInt16LE(0, 16); // ganho
    head[18] = 0; // mapeamento mono/estéreo
    this._writePage([head], 0, BOS);

    const vendor = Buffer.from("Foundry Listener", "utf8");
    const comments = Object.entries(tags).map(([k, v]) => Buffer.from(`${k}=${v}`, "utf8"));
    const parts = [Buffer.from("OpusTags", "ascii"), u32(vendor.length), vendor, u32(comments.length)];
    for (const c of comments) parts.push(u32(c.length), c);
    this._writePage([Buffer.concat(parts)], 0, 0);
  }

  /** Acrescenta um pacote Opus. `samples` é a duração dele em amostras de 48 kHz. */
  write(packet, samples = opusPacketSamples(packet)) {
    const segs = lacingFor(packet.length);
    if (this.pendingSegs + segs > 255) this.flush();
    this.pending.push(packet);
    this.pendingSegs += segs;
    this.pendingSamples += samples;
    this.granule += samples;
    if (this.pendingSamples >= PAGE_SAMPLES) this.flush();
  }

  /** Grava no disco os pacotes que ainda estão em memória. */
  flush(flags = 0) {
    if (!this.pending.length && !(flags & EOS)) return;
    this._writePage(this.pending, this.granule, flags);
    this.pending = [];
    this.pendingSegs = 0;
    this.pendingSamples = 0;
  }

  close() {
    if (this.fd == null) return;
    try {
      this.flush(EOS);
    } finally {
      closeSync(this.fd);
      this.fd = null;
    }
  }

  _writePage(packets, granule, flags) {
    const page = buildPage(packets, { granule, serial: this.serial, seq: this.seq++, flags });
    writeSync(this.fd, page);
    this.bytes += page.length;
  }
}

function u32(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
}
