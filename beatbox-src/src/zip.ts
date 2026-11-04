// Archive .zip minimale (sans compression), suffisante pour emballer un fichier MIDI.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of data) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function zipStore(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder();
  const parts: number[] = [];
  const central: number[] = [];
  const u16 = (a: number[], v: number) => a.push(v & 0xff, (v >>> 8) & 0xff);
  const u32 = (a: number[], v: number) => a.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const offset = parts.length;
    u32(parts, 0x04034b50); u16(parts, 20); u16(parts, 0); u16(parts, 0); u16(parts, 0); u16(parts, 0x21);
    u32(parts, crc); u32(parts, f.data.length); u32(parts, f.data.length); u16(parts, name.length); u16(parts, 0);
    parts.push(...name, ...f.data);
    u32(central, 0x02014b50); u16(central, 20); u16(central, 20); u16(central, 0); u16(central, 0); u16(central, 0); u16(central, 0x21);
    u32(central, crc); u32(central, f.data.length); u32(central, f.data.length); u16(central, name.length);
    u16(central, 0); u16(central, 0); u16(central, 0); u16(central, 0); u32(central, 0); u32(central, offset);
    central.push(...name);
  }
  const end: number[] = [];
  u32(end, 0x06054b50); u16(end, 0); u16(end, 0); u16(end, files.length); u16(end, files.length);
  u32(end, central.length); u32(end, parts.length); u16(end, 0);
  return new Uint8Array([...parts, ...central, ...end]);
}
