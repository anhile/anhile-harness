import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * The serverless entry point's logic, minus the framework.
 *
 * It lives here rather than in `api/index.ts` so that it can be tested.
 * That file cannot be: the platform compiles it, it imports the API's build
 * output, and Jest reaches neither.
 *
 * Three behaviours, and the first is why this exists as a unit rather than
 * as four lines in the entry point.
 *
 * **A failed boot is forgotten.** `started ??= boot()` remembers the
 * rejected promise: one second of an unreachable database at the wrong
 * moment, and every later request to that instance fails with the same
 * stale error until the platform recycles it.
 *
 * **A successful boot is kept.** One instance serves many invocations, and
 * rebuilding the framework per request puts its whole start-up on every
 * request's hot path.
 *
 * **Only the attempt that failed is cleared.** Two concurrent requests can
 * await the same rejected promise, and the second must not throw away a
 * fresh boot the first already started.
 */
export type RequestListener = (req: IncomingMessage, res: ServerResponse) => void;

export function createServerlessHandler(
  boot: () => Promise<RequestListener>,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  let started: Promise<RequestListener> | null = null;

  return async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const attempt = (started ??= boot());

    let app: RequestListener;
    try {
      app = await attempt;
    } catch {
      if (started === attempt) started = null;
      res.statusCode = 503;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ status: 'unavailable' }));
      return;
    }

    // The one transformation, and the reason it is needed is in vercel.json:
    // the intended path travels in a query parameter because catch-all
    // routing matched exactly one segment however it was declared. A request
    // that arrives without `__p` is passed through untouched.
    const url = new URL(req.url ?? '/', 'http://localhost');
    const target = url.searchParams.get('__p');
    if (target !== null) {
      // The caller's own query survives: the platform appends it to the
      // destination, so it sits alongside __p and has to be handed back
      // without it.
      url.searchParams.delete('__p');
      const query = url.searchParams.toString();
      req.url = query === '' ? target : `${target}?${query}`;
    }

    app(req, res);
  };
}
