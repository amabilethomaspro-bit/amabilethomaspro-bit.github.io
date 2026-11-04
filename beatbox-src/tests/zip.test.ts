import { it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import { writeFileSync, mkdtempSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { zipStore, crc32 } from '../src/zip';

it('crc32 connu', () => expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926));
it('le zip se décompresse avec unzip et redonne le fichier identique', () => {
  const data = new Uint8Array(300).map((_, i) => (i * 7) % 256);
  const dir = mkdtempSync(join(tmpdir(), 'z'));
  writeFileSync(join(dir, 'a.zip'), zipStore([{ name: 'beat.mid', data }]));
  execFileSync('unzip', ['-q', join(dir, 'a.zip'), '-d', join(dir, 'out')]);
  expect(new Uint8Array(readFileSync(join(dir, 'out', 'beat.mid')))).toEqual(data);
});
