// Official alert state, kept per exact location and away from forecast blending.
// A failed or partial poll changes nothing. Cancels and updates are applied from
// their references, and an alert leaves only after expiry, an explicit message,
// or being absent from two complete polls in a row.

import type { NwsAlertFeature } from '@/lib/alerts';

export type AlertRecord = { feature: NwsAlertFeature; eventKey: string; firstSeverity: string; absent: number };
export type AlertState = {
  records: Record<string, AlertRecord>;
  tombstones: Record<string, number>; // cancelled message id -> forget after
  lineage: Record<string, string>; // message id -> event key
  checkedAt: number | null;
};

export const emptyAlertState = (): AlertState => ({ records: {}, tombstones: {}, lineage: {}, checkedAt: null });

const WEEK = 7 * 86_400_000;
const idOf = (f: NwsAlertFeature) => f.properties.id ?? f.id;
const refsOf = (f: NwsAlertFeature) => (f.properties.references ?? []).map(r => r.identifier);

export function expiredAt(f: NwsAlertFeature): number {
  const t = f.properties.ends ?? f.properties.expires;
  return t ? Date.parse(t) : Infinity;
}

/** Applies one poll. `complete` is false when the response was paged and only partly read. */
export function applyPoll(prev: AlertState, features: NwsAlertFeature[], complete: boolean, now: number): AlertState {
  const s: AlertState = {
    ...prev, records: { ...prev.records }, tombstones: { ...prev.tombstones }, lineage: { ...prev.lineage },
    checkedAt: now,
  };
  const real = features.filter(f => (f.properties.status ?? 'Actual') === 'Actual');
  const seen = new Set<string>();

  // Cancels first, so a cancel arriving with or before its alert wins.
  for (const f of real) {
    if (f.properties.messageType !== 'Cancel') continue;
    for (const id of [idOf(f), ...refsOf(f)]) {
      s.tombstones[id] = now + WEEK;
      delete s.records[id];
    }
  }

  for (const f of real) {
    if (f.properties.messageType === 'Cancel') continue;
    const id = idOf(f);
    if (s.tombstones[id]) continue;
    seen.add(id);
    const refs = refsOf(f);
    const earlier = refs.map(r => s.lineage[r] ?? s.records[r]?.eventKey).find(Boolean);
    const eventKey = s.records[id]?.eventKey ?? s.lineage[id] ?? earlier ?? refs[0] ?? id;
    const first = refs.map(r => s.records[r]?.firstSeverity).find(Boolean);
    s.lineage[id] = eventKey;
    for (const r of refs) delete s.records[r]; // superseded by this revision
    s.records[id] = {
      feature: f, eventKey, absent: 0,
      firstSeverity: s.records[id]?.firstSeverity ?? first ?? f.properties.severity ?? '',
    };
  }

  // Absence alone counts only on complete polls, and only after a second one confirms it.
  if (complete) {
    for (const [id, r] of Object.entries(s.records)) {
      if (seen.has(id)) continue;
      const absent = r.absent + 1;
      if (absent >= 2) delete s.records[id]; else s.records[id] = { ...r, absent };
    }
  }

  for (const [id, r] of Object.entries(s.records)) if (expiredAt(r.feature) <= now) delete s.records[id];
  for (const [id, until] of Object.entries(s.tombstones)) if (until <= now) delete s.tombstones[id];
  const keep = new Set(Object.values(s.records).map(r => r.eventKey));
  for (const [id, k] of Object.entries(s.lineage)) if (!keep.has(k) && !s.tombstones[id]) delete s.lineage[id];
  return s;
}

/** Unexpired known alerts. An outage never empties this list. */
export const activeRecords = (s: AlertState, now: number) => Object.values(s.records).filter(r => expiredAt(r.feature) > now);

/** Fires once per event, and again only when the event's severity changes. */
export function notifyKey(r: Pick<AlertRecord, 'eventKey' | 'firstSeverity'>, severity: string | undefined): string {
  return !severity || severity === r.firstSeverity ? r.eventKey : `${r.eventKey}|${severity}`;
}
