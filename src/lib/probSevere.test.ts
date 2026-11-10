import { describe, expect, it } from 'vitest';
import { insideGeometry } from '@/radar/approach';
import fixture from './probSevere.fixture.json';
import { joinHistory, parseFile, parseIndex, pickFiles } from './probSevere';

const NOW = Date.UTC(2026, 10, 7, 4, 42, 39);
const MIN = 60_000;
const name = (at: number) => `MRMS_PROBSEVERE_${new Date(at).toISOString().replace(/[-:]/g, '').replace('T', '_').slice(0, 15)}.json`;
const every2 = (minutes: number[]) => minutes.map(m => ({ name: name(NOW - m * MIN), at: NOW - m * MIN }));
const square = [[-90, 40], [-89.9, 40], [-89.9, 40.1], [-90, 40.1], [-90, 40]];
const feature = (id: string, props: Record<string, string> = {}, coordinates: unknown = [square]) => ({
  type: 'Feature', geometry: { type: 'Polygon', coordinates },
  properties: { ID: id, MOTION_EAST: '5', MOTION_SOUTH: '-2', SIZE: '100', COMPREF: '50', VIL: '20', MESH: '1.5', ProbSevere: '10', ProbHail: '5', ProbWind: '7', ProbTor: '1', ...props },
});

describe('parseIndex', () => {
  it('reads file names and times from the index', () => {
    expect(parseIndex('<a href="MRMS_PROBSEVERE_20261107_044239.json">x</a> <a href="MRMS_PROBSEVERE_20261107_044239.json">x</a>')).toEqual([{ name: 'MRMS_PROBSEVERE_20261107_044239.json', at: NOW }]);
  });
  it('ignores names that do not match the pattern', () => {
    expect(parseIndex('<a href="../evil.json">x</a><a href="MRMS_PROBSEVERE_x.json">y</a><a href="http://bad/MRMS_PROBSEVERE_20261107_044239.json">z</a>')).toEqual([]);
  });
});

describe('pickFiles', () => {
  it('picks the newest file and the nearest to 10, 20 and 30 minutes back', () => {
    const files = every2(Array.from({ length: 21 }, (_, i) => i * 2));
    expect(pickFiles(files).map(f => (NOW - f.at) / MIN)).toEqual([0, 10, 20, 30]);
  });
  it('skips a history slot with no file within 3 minutes', () => {
    const files = every2([0, 2, 8, 10, 12, 28, 30, 32]);
    expect(pickFiles(files).map(f => (NOW - f.at) / MIN)).toEqual([0, 10, 30]);
  });
  it('prefers a file at or past each slot, so a 20-minute track really has 20 minutes', () => {
    expect(pickFiles(every2([0, 19, 21])).map(f => (NOW - f.at) / MIN)).toEqual([0, 21]);
  });
  it('never repeats a file', () => {
    expect(pickFiles(every2([0, 11, 12])).map(f => (NOW - f.at) / MIN)).toEqual([0, 11]);
  });
  it('has nothing to pick from an empty index', () => {
    expect(pickFiles([])).toEqual([]);
  });
});

describe('parseFile', () => {
  it('parses the real fixture', () => {
    const storms = parseFile(fixture, NOW);
    expect(storms).toHaveLength(3);
    const raw = fixture.features[0].properties;
    expect(storms[0]).toMatchObject({ id: String(raw.ID), at: NOW, dbz: Number(raw.COMPREF), vil: Number(raw.VIL), hailIn: Number(raw.MESH), probSevere: Number(raw.ProbSevere) });
    expect(storms[0].drift).toEqual({ eastMps: Number(raw.MOTION_EAST), northMps: -Number(raw.MOTION_SOUTH) });
    expect(insideGeometry(storms[0].center, { type: 'Polygon', coordinates: [storms[0].ring] })).toBe(true);
    expect(storms[0].past).toEqual([]);
  });
  it('turns non-numeric fields into null', () => {
    const [a] = parseFile({ features: [feature('1', { VIL: 'n/a', COMPREF: '' })] }, NOW);
    expect(a).toMatchObject({ vil: null, dbz: null, probTor: 1 });
    const { MOTION_EAST: _gone, ...noEast } = feature('2').properties;
    expect(parseFile({ features: [{ ...feature('2'), properties: noEast }] }, NOW)[0].drift).toBeNull();
  });
  it('treats exactly zero motion as unknown, because most such storms were moving', () => {
    expect(parseFile({ features: [feature('1', { MOTION_EAST: '0', MOTION_SOUTH: '0' })] }, NOW)[0].drift).toBeNull();
    expect(parseFile({ features: [feature('1', { MOTION_EAST: '0', MOTION_SOUTH: '-1' })] }, NOW)[0].drift).toEqual({ eastMps: 0, northMps: 1 });
  });
  it('drops only the malformed feature', () => {
    const file = { features: [feature('a'), feature('x', {}, [[[0, 0]]]), { properties: {}, geometry: null }, feature('y', {}, [[[0, 0], ['a', 1], [1, 1], [0, 0]]]), null, feature('b')] };
    expect(parseFile(file, NOW).map(s => s.id)).toEqual(['a', 'b']);
  });
  it('rejects a file with no feature list, so it never reads as no storms', () => {
    expect(() => parseFile({}, NOW)).toThrow();
    expect(() => parseFile(null, NOW)).toThrow();
  });
  it('accepts a real empty file', () => {
    expect(parseFile({ features: [] }, NOW)).toEqual([]);
  });
});

describe('joinHistory', () => {
  it('joins past centers by ID, oldest first', () => {
    const newest = parseFile({ features: [feature('1'), feature('2')] }, NOW);
    const ten = parseFile({ features: [feature('1')] }, NOW - 10 * MIN);
    const twenty = parseFile({ features: [feature('1'), feature('9')] }, NOW - 20 * MIN);
    const [one, two] = joinHistory(newest, [ten, twenty]);
    expect(one.past.map(p => p.at)).toEqual([NOW - 20 * MIN, NOW - 10 * MIN]);
    expect(two.past).toEqual([]);
  });
});
