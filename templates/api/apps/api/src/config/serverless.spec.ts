import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServerlessHandler, type RequestListener } from './serverless';

const request = (url: string): IncomingMessage => ({ url }) as IncomingMessage;

function response(): ServerResponse & { body: string } {
  const res = { statusCode: 200, body: '', setHeader: () => undefined, end(b: string) { res.body = b; } };
  return res as unknown as ServerResponse & { body: string };
}

describe('the serverless handler', () => {
  it('restores the path the platform moved into __p', async () => {
    const seen: string[] = [];
    const app: RequestListener = (req) => {
      seen.push(req.url ?? '');
    };
    const handler = createServerlessHandler(async () => app);

    await handler(request('/api?__p=/links/abc/stats'), response());

    expect(seen).toEqual(['/links/abc/stats']);
  });

  it("keeps the caller's own query and drops only __p", async () => {
    const seen: string[] = [];
    const handler = createServerlessHandler(async () => (req) => {
      seen.push(req.url ?? '');
    });

    await handler(request('/api?__p=/links&page=2'), response());

    expect(seen).toEqual(['/links?page=2']);
  });

  it('boots once and reuses it, so start-up is not on every request', async () => {
    let boots = 0;
    const handler = createServerlessHandler(async () => {
      boots += 1;
      return () => undefined;
    });

    await handler(request('/api?__p=/a'), response());
    await handler(request('/api?__p=/b'), response());

    expect(boots).toBe(1);
  });

  it('forgets a failed boot rather than serving its error forever', async () => {
    let boots = 0;
    const handler = createServerlessHandler(async () => {
      boots += 1;
      if (boots === 1) throw new Error('database unreachable');
      return () => undefined;
    });

    const first = response();
    await handler(request('/api?__p=/a'), first);
    expect(first.statusCode).toBe(503);

    // The instance is still warm. Without the clear, this request would be
    // answered by the remembered rejection instead of a fresh boot.
    const second = response();
    await handler(request('/api?__p=/a'), second);
    expect(second.statusCode).toBe(200);
    expect(boots).toBe(2);
  });
});
