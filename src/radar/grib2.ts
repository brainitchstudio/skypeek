// GRIB2 decoding for the one profile Sky Peek uses: HRRR 1000 m reflectivity on
// its Lambert conformal grid, complex packing with second-order spatial
// differencing. Anything else is refused by name rather than decoded by guess.
// Octet positions below are 1-based, as in the WMO tables.

export type LambertGrid = { ni: number; nj: number; lat1: number; lon1: number; lov: number; latin1: number; latin2: number; dx: number; dy: number; radius: number };
export type GribField = { grid: LambertGrid; values: Uint16Array; maxX: number; r: number; e: number; d: number; refTime: number; leadMin: number };
export type GribErrorCode = 'not-grib' | 'truncated' | 'wrong-field' | 'unsupported-grid' | 'unsupported-packing' | 'bad-data';

export class GribError extends Error {
  constructor(public code: GribErrorCode, message: string) { super(message); this.name = 'GribError'; }
}

/** The dBZ value a raw packed integer stands for. */
export const fieldValue = (f: Pick<GribField, 'r' | 'e' | 'd'>, x: number) => (f.r + x * 2 ** f.e) / 10 ** f.d;

const EARTH_SHAPE_6_RADIUS = 6371229;
const WIDEST_GROUP_BITS = 32;

type Sections = Partial<Record<1 | 3 | 4 | 5 | 6 | 7, { at: number; length: number }>>;

function findSections(view: DataView, total: number): Sections {
  const found: Sections = {};
  let p = 16;
  while (p + 4 <= total - 4) {
    const length = view.getUint32(p);
    if (length < 5 || p + length > total - 4) throw new GribError('truncated', 'A section runs past the end of the message');
    const n = view.getUint8(p + 4);
    if (n === 1 || n === 3 || n === 4 || n === 5 || n === 6 || n === 7) found[n] = { at: p, length };
    p += length;
  }
  if (p !== total - 4) throw new GribError('truncated', 'Sections do not end at the end marker');
  return found;
}

const signMagnitude = (raw: number, bits: number) => {
  const top = 2 ** (bits - 1);
  return raw >= top ? -(raw - top) : raw;
};

function readGrid(view: DataView, at: number, length: number): LambertGrid {
  if (length < 73) throw new GribError('unsupported-grid', 'Grid section is too short');
  if (view.getUint16(at + 12) !== 30) throw new GribError('unsupported-grid', 'Grid is not Lambert conformal');
  if (view.getUint8(at + 14) !== 6) throw new GribError('unsupported-grid', 'Earth shape is not 6');
  if (view.getUint8(at + 64) !== 64) throw new GribError('unsupported-grid', 'Scanning mode is not 64');
  const ni = view.getUint32(at + 30), nj = view.getUint32(at + 34);
  if (view.getUint32(at + 6) !== ni * nj) throw new GribError('bad-data', 'Point count does not match the grid');
  return {
    ni, nj,
    lat1: view.getUint32(at + 38) / 1e6, lon1: view.getUint32(at + 42) / 1e6, lov: view.getUint32(at + 51) / 1e6,
    dx: view.getUint32(at + 55) / 1000, dy: view.getUint32(at + 59) / 1000,
    latin1: view.getUint32(at + 65) / 1e6, latin2: view.getUint32(at + 69) / 1e6,
    radius: EARTH_SHAPE_6_RADIUS,
  };
}

function readProduct(view: DataView, at: number, length: number) {
  const wrong = (m: string) => new GribError('wrong-field', m);
  if (length < 28 || view.getUint16(at + 7) !== 0) throw wrong('Product template is not 0');
  if (view.getUint8(at + 9) !== 16 || view.getUint8(at + 10) !== 195) throw wrong('Field is not reflectivity at a height');
  if (view.getUint8(at + 17) !== 0) throw wrong('Lead time is not in minutes');
  if (view.getUint8(at + 22) !== 103 || view.getUint8(at + 23) !== 0 || view.getUint32(at + 24) !== 1000) throw wrong('Level is not 1000 m above ground');
  return view.getUint32(at + 18);
}

function readPacking(view: DataView, at: number, length: number) {
  const refuse = (m: string) => new GribError('unsupported-packing', m);
  if (length < 49 || view.getUint16(at + 9) !== 3) throw refuse('Data is not complex packing with spatial differencing');
  if (view.getUint8(at + 21) !== 1) throw refuse('Group splitting is not general');
  if (view.getUint8(at + 22) !== 0) throw refuse('Missing-value management is in use');
  if (view.getUint8(at + 47) !== 2 || view.getUint8(at + 48) !== 2) throw refuse('Spatial differencing is not second order with two extra octets');
  return {
    count: view.getUint32(at + 5),
    r: view.getFloat32(at + 11),
    e: signMagnitude(view.getUint16(at + 15), 16),
    d: signMagnitude(view.getUint16(at + 17), 16),
    refBits: view.getUint8(at + 19),
    groups: view.getUint32(at + 31),
    widthRef: view.getUint8(at + 35),
    widthBits: view.getUint8(at + 36),
    lengthRef: view.getUint32(at + 37),
    lengthStep: view.getUint8(at + 41),
    lastLength: view.getUint32(at + 42),
    lengthBits: view.getUint8(at + 46),
  };
}

/** Reads `n` big-endian bits (0 to 32) starting at bit `pos`. Bounds are checked by the caller. */
function bitsAt(b: Uint8Array, pos: number, n: number) {
  let value = 0, byte = pos >>> 3, offset = pos & 7, left = n;
  while (left > 0) {
    const take = Math.min(8 - offset, left);
    value = value * 2 ** take + ((b[byte] >> (8 - offset - take)) & ((1 << take) - 1));
    left -= take; offset = 0; byte++;
  }
  return value;
}

function unpack(bytes: Uint8Array, view: DataView, at: number, length: number, p: ReturnType<typeof readPacking>) {
  const bad = (m: string) => new GribError('bad-data', m);
  const end = (at + length) * 8;
  if (length < 11 || !p.groups) throw bad('Data section has no groups');
  const first = signMagnitude(view.getUint16(at + 5), 16), second = signMagnitude(view.getUint16(at + 7), 16);
  const hmin = signMagnitude(view.getUint16(at + 9), 16);

  let pos = (at + 11) * 8;
  const take = (bits: number) => {
    const start = pos;
    pos = start + p.groups * bits;
    if (pos > end) throw bad('Group tables run past the data section');
    pos = Math.ceil(pos / 8) * 8;
    return start;
  };
  const refsAt = take(p.refBits), widthsAt = take(p.widthBits), lengthsAt = take(p.lengthBits);

  const lengths = new Uint32Array(p.groups), widths = new Uint8Array(p.groups);
  let points = 0, packedBits = 0;
  for (let g = 0; g < p.groups; g++) {
    const width = p.widthRef + bitsAt(bytes, widthsAt + g * p.widthBits, p.widthBits);
    if (width > WIDEST_GROUP_BITS) throw bad('A group is wider than 32 bits');
    const size = g === p.groups - 1 ? p.lastLength : p.lengthRef + p.lengthStep * bitsAt(bytes, lengthsAt + g * p.lengthBits, p.lengthBits);
    widths[g] = width; lengths[g] = size;
    points += size; packedBits += size * width;
  }
  if (points !== p.count) throw bad('Group lengths do not add up to the point count');
  if (pos + packedBits > end) throw bad('Packed values run past the data section');

  const values = new Uint16Array(p.count);
  let maxX = 0, n = 0, previous = second, beforeThat = first;
  const store = (x: number) => {
    if (x < 0 || x > 65535) throw bad('A value does not fit its range');
    if (x > maxX) maxX = x;
    values[n++] = x;
  };
  for (let g = 0; g < p.groups; g++) {
    const ref = bitsAt(bytes, refsAt + g * p.refBits, p.refBits), width = widths[g];
    for (let i = 0; i < lengths[g]; i++) {
      const packed = ref + (width ? bitsAt(bytes, pos, width) : 0);
      pos += width;
      if (n === 0) store(first);
      else if (n === 1) store(second);
      else {
        const x = packed + hmin + 2 * previous - beforeThat;
        store(x);
        beforeThat = previous;
        previous = x;
      }
    }
  }
  return { values, maxX };
}

export function decodeGrib2(bytes: Uint8Array): GribField {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 16 || view.getUint32(0) !== 0x47524942) throw new GribError('not-grib', 'Missing GRIB marker');
  if (bytes[7] !== 2) throw new GribError('not-grib', 'Not GRIB edition 2');
  if (bytes[6] !== 0) throw new GribError('wrong-field', 'Not a meteorological product');
  const total = Number(view.getBigUint64(8));
  if (total > bytes.length) throw new GribError('truncated', 'Message is shorter than its stated length');
  if (view.getUint32(total - 4) !== 0x37373737) throw new GribError('truncated', 'Missing end marker');

  const s = findSections(view, total);
  if (!s[1] || !s[3] || !s[4] || !s[5] || !s[6] || !s[7]) throw new GribError('truncated', 'A required section is missing');

  const leadMin = readProduct(view, s[4].at, s[4].length);
  const grid = readGrid(view, s[3].at, s[3].length);
  const packing = readPacking(view, s[5].at, s[5].length);
  if (view.getUint8(s[6].at + 5) !== 255) throw new GribError('unsupported-packing', 'A bitmap is present');
  if (packing.count !== grid.ni * grid.nj) throw new GribError('bad-data', 'Data point count does not match the grid');

  const a = s[1].at;
  const refTime = Date.UTC(view.getUint16(a + 12), bytes[a + 14] - 1, bytes[a + 15], bytes[a + 16], bytes[a + 17], bytes[a + 18]);
  const { values, maxX } = unpack(bytes, view, s[7].at, s[7].length, packing);
  return { grid, values, maxX, r: packing.r, e: packing.e, d: packing.d, refTime, leadMin };
}
