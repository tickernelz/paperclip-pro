const OGG_CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index++) {
    let value = index << 24;
    for (let bit = 0; bit < 8; bit++) value = value & 0x80000000 ? (value << 1) ^ 0x04c11db7 : value << 1;
    table[index] = value >>> 0;
  }
  return table;
})();

const OPUS_SAMPLE_RATE = 48_000;
const NO_GRANULE = 0xffffffffffffffffn;
const FLAG_CONTINUED = 0x01;
const FLAG_FIRST = 0x02;
const FLAG_LAST = 0x04;

export interface OggPage {
  start: number;
  end: number;
  flags: number;
  granule: bigint;
}

export function oggCrc(page: Uint8Array): number {
  let crc = 0;
  for (const byte of page) crc = ((crc << 8) ^ OGG_CRC_TABLE[((crc >>> 24) ^ byte) & 0xff]) >>> 0;
  return crc;
}

export function parseOggPages(body: Buffer): OggPage[] | null {
  const pages: OggPage[] = [];
  let offset = 0;
  while (offset < body.length) {
    if (offset + 27 > body.length || body.toString("latin1", offset, offset + 4) !== "OggS") return null;
    const segments = body[offset + 26];
    if (offset + 27 + segments > body.length) return null;
    let size = 0;
    for (let index = 0; index < segments; index++) size += body[offset + 27 + index];
    const end = offset + 27 + segments + size;
    if (end > body.length) return null;
    pages.push({ start: offset, end, flags: body[offset + 5], granule: body.readBigUInt64LE(offset + 6) });
    offset = end;
  }
  return pages;
}

function rewritePage(source: Buffer, page: OggPage, sequence: number, granule: bigint, flags: number): Buffer {
  const copy = Buffer.from(source.subarray(page.start, page.end));
  copy[5] = flags;
  copy.writeBigUInt64LE(granule, 6);
  copy.writeUInt32LE(sequence, 18);
  copy.writeUInt32LE(0, 22);
  copy.writeUInt32LE(oggCrc(copy), 22);
  return copy;
}

export function splitOggOpus(body: Buffer, maxSeconds: number): Buffer[] | null {
  const pages = parseOggPages(body);
  if (!pages || pages.length < 3 || body.indexOf("OpusHead", 0, "latin1") !== 28) return null;
  const headerCount = pages.findIndex((page) => page.granule !== 0n);
  if (headerCount < 2) return null;
  const headers = pages.slice(0, headerCount);
  const audio = pages.slice(headerCount);
  const limit = BigInt(Math.floor(maxSeconds * OPUS_SAMPLE_RATE));
  const groups: Array<{ base: bigint; pages: OggPage[] }> = [];
  let base = 0n;
  let current: OggPage[] = [];
  let lastGranule = 0n;
  for (const page of audio) {
    const splittable = (page.flags & FLAG_CONTINUED) === 0 && current.length > 0;
    if (splittable && page.granule !== NO_GRANULE && page.granule - base > limit) {
      groups.push({ base, pages: current });
      base = lastGranule;
      current = [];
    }
    current.push(page);
    if (page.granule !== NO_GRANULE) {
      if (page.granule < lastGranule) return null;
      lastGranule = page.granule;
    }
  }
  if (current.length > 0) groups.push({ base, pages: current });
  if (groups.length === 1) return [body];
  return groups.map((group) => {
    const parts = headers.map((page, index) => rewritePage(body, page, index, page.granule, page.flags & ~FLAG_LAST));
    group.pages.forEach((page, index) => {
      const last = index === group.pages.length - 1;
      const granule = page.granule === NO_GRANULE ? NO_GRANULE : page.granule - group.base;
      const flags = (page.flags & ~(FLAG_LAST | FLAG_FIRST)) | (last ? FLAG_LAST : 0);
      parts.push(rewritePage(body, page, headerCount + index, granule, flags));
    });
    return Buffer.concat(parts);
  });
}
