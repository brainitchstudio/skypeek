import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/locationGeography', () => ({ resolveGeography: vi.fn() }));
import { resolveGeography } from '@/lib/locationGeography';
import { GET } from './route';
const resolve = vi.mocked(resolveGeography);
beforeEach(() => { resolve.mockReset(); });
describe('location endpoint', () => {
  it.each(['', '?lat=&lon=0&accuracy=0', '?lat=91&lon=0&accuracy=20', '?lat=0&lon=181&accuracy=20', '?lat=0&lon=0&accuracy=-1', '?lat=NaN&lon=0&accuracy=20'])('rejects invalid coordinates: %s', async query => {
    expect((await GET(new Request(`http://localhost/api/location${query}`))).status).toBe(400);
    expect(resolve).not.toHaveBeenCalled();
  });
  it('returns a private response for valid device coordinates', async () => {
    resolve.mockResolvedValue({ region: 'Benton County, AR' });
    const response = await GET(new Request('http://localhost/api/location?lat=36.37&lon=-94.21&accuracy=20'));
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(resolve).toHaveBeenCalledWith({ lat: 36.37, lon: -94.21 }, 20);
    expect(await response.json()).toEqual({ region: 'Benton County, AR' });
  });
  it('fails without exposing upstream errors', async () => {
    resolve.mockImplementation(async () => { throw new Error('upstream details'); });
    const response = await GET(new Request('http://localhost/api/location?lat=0&lon=0&accuracy=20'));
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain('upstream details');
  });
});
