import { describe, expect, it, vi } from 'vitest';
import { boundedBody, boundedForm, boundedJson } from './requestBody';

function streamRequest(parts: string[], type = 'application/json', length?: string) {
  const cancel = vi.fn();
  const body = new ReadableStream({ start(controller) { for (const part of parts) controller.enqueue(new TextEncoder().encode(part)); }, cancel });
  const request = new Request('https://example.test', { method: 'POST', body, duplex: 'half', headers: { 'content-type': type, ...(length ? { 'content-length': length } : {}) } } as RequestInit);
  return { request, cancel };
}

describe('received-byte request limits', () => {
  it.each([undefined, '1'])('rejects oversized streams regardless of declared length %s', async length => {
    const { request, cancel } = streamRequest(['1234', '5678', 'never parsed'], 'application/json', length);
    await expect(boundedJson(request, 6)).rejects.toMatchObject({ status: 413 });
    expect(cancel).toHaveBeenCalled();
  });
  it('counts UTF-8 bytes and accepts exactly the limit', async () => {
    const request = (text: string) => new Request('https://example.test', { method: 'POST', body: text, headers: { 'content-type': 'application/json' } });
    await expect(boundedJson(request('"é"'), 4)).resolves.toBe('é');
    await expect(boundedJson(request('"é"'), 3)).rejects.toMatchObject({ status: 413 });
  });
  it('decodes ordinary percent-encoded forms after enforcing byte limits', async () => {
    const request = new Request('https://example.test', { method: 'POST', body: new URLSearchParams({ code: 'a+b & c' }) });
    expect((await boundedForm(request, 100)).get('code')).toBe('a+b & c');
  });
  it('rejects unsupported formats and malformed JSON', async () => {
    await expect(boundedJson(new Request('https://example.test', { method: 'POST', body: '{}' }), 10)).rejects.toMatchObject({ status: 415 });
    await expect(boundedJson(new Request('https://example.test', { method: 'POST', body: '{', headers: { 'content-type': 'application/json' } }), 10)).rejects.toThrow();
  });
  it('cancels a stalled stream instead of waiting indefinitely', async () => {
    const { request, cancel } = streamRequest([]);
    await expect(boundedBody(request, 10, 'application/json', 10)).rejects.toMatchObject({ status: 408 });
    expect(cancel).toHaveBeenCalled();
  });
});
