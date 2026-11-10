// Operational diagnostics remain readable even if IndexedDB fails. This bounded
// localStorage journal is best effort, never a replacement for durable telemetry.
export type Diagnostic = { id: string; at: number; area: string; message: string };
const KEY = 'sky-peek-diagnostics';
export function diagnostics(): Diagnostic[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]'); } catch { return []; }
}
export function recordDiagnostic(area: string, message: string) {
  const row = { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, at: Date.now(), area, message };
  try { localStorage.setItem(KEY, JSON.stringify([row, ...diagnostics()].slice(0, 200))); } catch { /* storage itself may be unavailable */ }
}
