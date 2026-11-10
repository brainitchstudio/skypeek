import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { decodeGrib2, fieldValue, GribError, type GribErrorCode } from './grib2';
import golden from './__fixtures__/refd-golden.json';

const FIXTURE = fileURLToPath(new URL('./__fixtures__/refd.grib2', import.meta.url));
const bytes = new Uint8Array(readFileSync(FIXTURE));

/** Offset of a section's first octet in a single-message file. */
function sectionAt(data: Uint8Array, n: number) {
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let p = 16;
  while (data[p + 4] !== n) p += v.getUint32(p);
  return p;
}
const edited = (edit: (b: Uint8Array) => void) => { const b = bytes.slice(); edit(b); return b; };
const codeOf = (b: Uint8Array): GribErrorCode | null => {
  try { decodeGrib2(b); return null; } catch (e) { if (e instanceof GribError) return e.code; throw e; }
};

/** Packs a small, valid message, so unusual group layouts can be tested. */
class Bits {
  out: number[] = []; private cur = 0; private used = 0;
  put(v: number, n: number) {
    for (let i = n - 1; i >= 0; i--) {
      this.cur = (this.cur << 1) | (Math.floor(v / 2 ** i) & 1);
      if (++this.used === 8) { this.out.push(this.cur); this.cur = 0; this.used = 0; }
    }
  }
  align() { while (this.used) this.put(0, 1); }
}
const u = (v: number, n: number) => Array.from({ length: n }, (_, i) => Math.floor(v / 256 ** (n - 1 - i)) & 255);
const signed = (v: number, n: number) => u(Math.abs(v) + (v < 0 ? 2 ** (8 * n - 1) : 0), n);
const section = (n: number, body: number[]) => [...u(body.length + 5, 4), n, ...body];

type Group = { ref: number; width: number; vals: number[] };
function buildGrib({ h1, h2, hmin, groups, extraPoints = 0 }: { h1: number; h2: number; hmin: number; groups: Group[]; extraPoints?: number }) {
  const count = groups.reduce((s, g) => s + g.vals.length, 0) + extraPoints;
  const bits = new Bits();
  for (const g of groups) bits.put(g.ref, 16); bits.align();
  for (const g of groups) bits.put(g.width, 8); bits.align();
  for (const g of groups.slice(0, -1)) bits.put(g.vals.length, 8);
  bits.put(0, 8); bits.align();
  for (const g of groups) for (const v of g.vals) bits.put(v - g.ref, g.width);
  bits.align();
  const s1 = section(1, [...u(7, 2), ...u(0, 2), 2, 1, 1, ...u(2026, 2), 11, 5, 20, 0, 0, 0, 1]);
  const s3 = new Array(76).fill(0);
  s3.splice(0, 5, 0, ...u(count, 4)); s3.splice(7, 2, ...u(30, 2)); s3[9] = 6;
  s3.splice(25, 8, ...u(4, 4), ...u(3, 4));
  s3.splice(33, 8, ...u(21138123, 4), ...u(237280472, 4));
  s3.splice(46, 4, ...u(262500000, 4));
  s3.splice(50, 8, ...u(3_000_000, 4), ...u(3_000_000, 4));
  s3[59] = 64;
  s3.splice(60, 8, ...u(38500000, 4), ...u(38500000, 4));
  const s4 = new Array(29).fill(0);
  s4.splice(2, 2, ...u(0, 2)); s4[4] = 16; s4[5] = 195; s4[12] = 0;
  s4.splice(13, 4, ...u(90, 4)); s4[17] = 103; s4[18] = 0; s4.splice(19, 4, ...u(1000, 4));
  const s5 = [...u(count, 4), ...u(3, 2), 0, 0, 0, 0, ...signed(0, 2), ...signed(0, 2), 16, 0,
    1, 0, ...u(0, 4), ...u(0, 4), ...u(groups.length, 4), 0, 8, ...u(0, 4), 1, ...u(groups.at(-1)!.vals.length, 4), 8, 2, 2];
  const s7 = [...signed(h1, 2), ...signed(h2, 2), ...signed(hmin, 2), ...bits.out];
  const body = [...s1, ...section(3, s3), ...section(4, s4), ...section(5, s5), ...section(6, [255]), ...section(7, s7), 0x37, 0x37, 0x37, 0x37];
  return Uint8Array.from([0x47, 0x52, 0x49, 0x42, 0, 0, 0, 2, ...u(body.length + 16, 8), ...body]);
}

describe('decodeGrib2 on a real HRRR field', () => {
  it('matches ecCodes on all grid points', () => {
    const f = decodeGrib2(bytes);
    expect(f.values.length).toBe(golden.count);
    const out = new Int16Array(f.values.length);
    f.values.forEach((x, i) => { out[i] = Math.round(fieldValue(f, x) * 16); });
    const sha = createHash('sha256').update(new Uint8Array(out.buffer)).digest('hex');
    for (const s of golden.samples) expect(fieldValue(f, f.values[s.i])).toBeCloseTo(s.v, 6);
    expect(sha).toBe(golden.sha256);
  });

  it('reads the grid from the header', () => {
    expect(decodeGrib2(bytes).grid).toMatchObject({ ni: 1799, nj: 1059, lat1: 21.138123, lon1: 237.280472, lov: 262.5, latin1: 38.5, latin2: 38.5, dx: 3000, dy: 3000, radius: 6371229 });
  });

  it('reads the run time and lead', () => {
    expect(decodeGrib2(bytes)).toMatchObject({ refTime: golden.refTime, leadMin: golden.leadMin });
  });

  it('keeps the largest raw integer', () => {
    const f = decodeGrib2(bytes);
    expect(fieldValue(f, f.maxX)).toBe(golden.max);
  });
});

describe('decodeGrib2 refuses what it does not support', () => {
  const s = (n: number) => sectionAt(bytes, n);
  it.each<[string, (b: Uint8Array) => void, GribErrorCode]>([
    ['magic not GRIB', b => { b[0] = 0; }, 'not-grib'],
    ['edition 1', b => { b[7] = 1; }, 'not-grib'],
    ['discipline 2', b => { b[6] = 2; }, 'wrong-field'],
    ['end marker missing', b => { b[b.length - 1] = 0; }, 'truncated'],
    ['parameter number 196', b => { b[s(4) + 10] = 196; }, 'wrong-field'],
    ['category 0', b => { b[s(4) + 9] = 0; }, 'wrong-field'],
    ['surface type 1', b => { b[s(4) + 22] = 1; }, 'wrong-field'],
    ['height 2000', b => { new DataView(b.buffer).setUint32(s(4) + 24, 2000); }, 'wrong-field'],
    ['lead in hours', b => { b[s(4) + 17] = 1; }, 'wrong-field'],
    ['grid template 0', b => { b[s(3) + 13] = 0; }, 'unsupported-grid'],
    ['scanning mode 0', b => { b[s(3) + 64] = 0; }, 'unsupported-grid'],
    ['earth shape 1', b => { b[s(3) + 14] = 1; }, 'unsupported-grid'],
    ['point count off by one', b => { b[s(3) + 9] ^= 1; }, 'bad-data'],
    ['data template 0', b => { b[s(5) + 10] = 0; }, 'unsupported-packing'],
    ['missing-value management 1', b => { b[s(5) + 22] = 1; }, 'unsupported-packing'],
    ['spatial order 1', b => { b[s(5) + 47] = 1; }, 'unsupported-packing'],
    ['group splitting 0', b => { b[s(5) + 21] = 0; }, 'unsupported-packing'],
    ['bitmap present', b => { b[s(6) + 5] = 0; }, 'unsupported-packing'],
  ])('%s', (_name, edit, code) => {
    expect(codeOf(edited(edit))).toBe(code);
  });

  it('refuses a file cut short', () => {
    expect(codeOf(bytes.slice(0, bytes.length - 1000))).toBe('truncated');
  });

  it('refuses a file with no sections', () => {
    expect(codeOf(bytes.slice(0, 20))).toBe('truncated');
  });
});

describe('decodeGrib2 group handling', () => {
  // packed + hmin + 2X[n-1] - X[n-2], from X[0] = 5 and X[1] = 7
  const groups: Group[] = [
    { ref: 0, width: 2, vals: [0, 0, 2, 2, 2, 2] },
    { ref: 1, width: 0, vals: [1, 1, 1, 1, 1, 1] },
  ];

  it('undoes spatial differencing across zero-width groups', () => {
    const f = decodeGrib2(buildGrib({ h1: 5, h2: 7, hmin: -2, groups }));
    expect([...f.values]).toEqual([5, 7, 9, 11, 13, 15, 16, 16, 15, 13, 10, 6]);
    expect(f.maxX).toBe(16);
  });

  it('takes the final group length from the true last length', () => {
    const three = [{ ...groups[0] }, { ref: 1, width: 0, vals: [1, 1] }, { ref: 1, width: 0, vals: [1, 1, 1, 1] }];
    expect([...decodeGrib2(buildGrib({ h1: 5, h2: 7, hmin: -2, groups: three })).values]).toEqual([5, 7, 9, 11, 13, 15, 16, 16, 15, 13, 10, 6]);
  });

  it('refuses a value too large to store', () => {
    expect(codeOf(buildGrib({ h1: 0, h2: 40000, hmin: 0, groups }))).toBe('bad-data');
  });

  it('refuses a negative value', () => {
    expect(codeOf(buildGrib({ h1: 5, h2: 0, hmin: -2, groups }))).toBe('bad-data');
  });

  it('refuses a grid and data section that disagree on point count', () => {
    expect(codeOf(buildGrib({ h1: 5, h2: 7, hmin: -2, groups, extraPoints: 1 }))).toBe('bad-data');
  });

  it('refuses groups that do not add up to the point count', () => {
    const message = buildGrib({ h1: 5, h2: 7, hmin: -2, groups });
    message[sectionAt(message, 5) + 45] -= 1; // true last length, low octet
    expect(codeOf(message)).toBe('bad-data');
  });
});
