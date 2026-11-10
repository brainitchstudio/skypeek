import { describe, expect, it } from 'vitest';
import { activeRecords, applyPoll, emptyAlertState, notifyKey, type AlertState } from './alertState';
import type { NwsAlertFeature } from '@/lib/alerts';

const NOW = Date.parse('2026-11-05T18:00:00Z');
const LATER = '2026-11-05T22:00:00Z';

const alert = (id: string, p: Partial<NwsAlertFeature['properties']> = {}): NwsAlertFeature => ({
  id, geometry: null, properties: { id, event: 'Flood Warning', status: 'Actual', messageType: 'Alert', severity: 'Moderate', expires: LATER, ...p },
});
const ids = (s: AlertState, now = NOW) => activeRecords(s, now).map(r => r.feature.properties.id);

describe('alert state', () => {
  it('excludes test and exercise messages', () => {
    expect(ids(applyPoll(emptyAlertState(), [alert('t', { status: 'Test' }), alert('e', { status: 'Exercise' })], true, NOW))).toEqual([]);
  });

  it('applies an update as a new revision of the same event', () => {
    let s = applyPoll(emptyAlertState(), [alert('a')], true, NOW);
    s = applyPoll(s, [alert('b', { messageType: 'Update', references: [{ identifier: 'a' }] })], true, NOW + 1);
    expect(ids(s)).toEqual(['b']);
    expect(s.records.b.eventKey).toBe('a');
  });

  it('removes an alert on an explicit cancel', () => {
    let s = applyPoll(emptyAlertState(), [alert('a')], true, NOW);
    s = applyPoll(s, [alert('c', { messageType: 'Cancel', references: [{ identifier: 'a' }] }), alert('a')], true, NOW + 1);
    expect(ids(s)).toEqual([]);
  });

  it('a cancel that arrives first suppresses the late alert', () => {
    let s = applyPoll(emptyAlertState(), [alert('c', { messageType: 'Cancel', references: [{ identifier: 'a' }] })], true, NOW);
    s = applyPoll(s, [alert('a')], true, NOW + 1);
    expect(ids(s)).toEqual([]);
  });

  it('keeps alerts through a partial poll', () => {
    let s = applyPoll(emptyAlertState(), [alert('a')], true, NOW);
    for (let i = 1; i < 5; i++) s = applyPoll(s, [], false, NOW + i);
    expect(ids(s)).toEqual(['a']);
  });

  it('removes on absence only after a confirming complete poll', () => {
    let s = applyPoll(emptyAlertState(), [alert('a')], true, NOW);
    s = applyPoll(s, [], true, NOW + 1);
    expect(ids(s)).toEqual(['a']);
    s = applyPoll(s, [], true, NOW + 2);
    expect(ids(s)).toEqual([]);
  });

  it('a reappearing alert resets its absence', () => {
    let s = applyPoll(emptyAlertState(), [alert('a')], true, NOW);
    s = applyPoll(s, [], true, NOW + 1);
    s = applyPoll(s, [alert('a')], true, NOW + 2);
    s = applyPoll(s, [], true, NOW + 3);
    expect(ids(s)).toEqual(['a']);
  });

  it('never shows an expired warning as current, even without polling', () => {
    const s = applyPoll(emptyAlertState(), [alert('a')], true, NOW);
    expect(ids(s, Date.parse(LATER) + 1)).toEqual([]);
  });

  it('keeps first-issued severity through updates so only escalation renotifies', () => {
    let s = applyPoll(emptyAlertState(), [alert('a', { severity: 'Moderate' })], true, NOW);
    const key1 = notifyKey(s.records.a, 'Moderate');
    s = applyPoll(s, [alert('b', { messageType: 'Update', references: [{ identifier: 'a' }], severity: 'Moderate' })], true, NOW + 1);
    expect(notifyKey(s.records.b, 'Moderate')).toBe(key1);
    s = applyPoll(s, [alert('c', { messageType: 'Update', references: [{ identifier: 'b' }], severity: 'Extreme' })], true, NOW + 2);
    expect(notifyKey(s.records.c, 'Extreme')).toBe('a|Extreme');
  });
});
