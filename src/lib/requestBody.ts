/** Limits received bytes, including streamed requests without Content-Length. */
export class RequestBodyError extends Error {
  constructor(public status: number, message = 'Invalid request.') { super(message); }
}

export async function boundedBody(request: Request, limit: number, type: string | string[], timeoutMs = 5000): Promise<string> {
  const allowed = Array.isArray(type) ? type : [type];
  if (!allowed.includes(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? '')) {
    throw new RequestBodyError(415, 'Unsupported request format.');
  }
  const declared = request.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > limit)) {
    throw new RequestBodyError(413, 'Request is too large.');
  }
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new RequestBodyError(408, 'Request timed out.')), timeoutMs);
  });
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), timeout]);
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new RequestBodyError(413, 'Request is too large.');
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    // Do not wait on an uncooperative sender to acknowledge cancellation.
    void reader.cancel().catch(() => {});
    throw error;
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
}

export async function boundedJson(request: Request, limit: number): Promise<unknown> {
  return JSON.parse(await boundedBody(request, limit, 'application/json'));
}

export async function boundedForm(request: Request, limit: number): Promise<FormData> {
  const text = await boundedBody(request, limit, ['application/x-www-form-urlencoded', 'multipart/form-data']);
  return new Response(text, { headers: { 'content-type': request.headers.get('content-type')! } }).formData();
}

export const bodyErrorStatus = (error: unknown) => error instanceof RequestBodyError ? error.status : 400;
