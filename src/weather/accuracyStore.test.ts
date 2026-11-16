import { expect, it, vi } from 'vitest';
import { maintainAccuracyStore, memoryStore, pruneCutoff } from './accuracyStore';

it('prunes existing-scope history on startup and again daily, including obsolete metadata', async () => {
  const now = Date.now();
  const store = memoryStore();
  await store.setMeta({ scope: 'existing', trackingStart: now, truthThrough: now, lastCapture: 'existing' });
  await store.setMeta({ scope: 'old', trackingStart: 0, truthThrough: 0, lastCapture: 'old' });
  const prune = vi.spyOn(store, 'prune');
  await maintainAccuracyStore(store, now);
  expect(prune).toHaveBeenCalledWith(pruneCutoff(now));
  expect(await store.meta('old')).toBeNull();
  expect(await store.meta('existing')).not.toBeNull();
  await maintainAccuracyStore(store, now + 1000);
  expect(prune).toHaveBeenCalledTimes(1);
  await maintainAccuracyStore(store, now + 86_400_000);
  expect(prune).toHaveBeenCalledTimes(2);
});
it('retries failed cleanup rather than recording a successful maintenance timestamp', async () => {
  const store = memoryStore();
  const prune = vi.spyOn(store, 'prune').mockRejectedValueOnce(new Error('storage failure'));
  await expect(maintainAccuracyStore(store, Date.now())).rejects.toThrow();
  await maintainAccuracyStore(store, Date.now());
  expect(prune).toHaveBeenCalledTimes(2);
});
