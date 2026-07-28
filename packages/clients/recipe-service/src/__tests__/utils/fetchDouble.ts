/**
 * Shared `fetch` doubles for the {@link RecipeServiceClient} unit tests. The client drives HTTP through
 * `ky`, which invokes the injected `fetch` with a {@link Request} object (not a `(url, init)` pair), so
 * these doubles assert the *observable* request a fake fetch receives — the `Request`'s URL, method,
 * headers, and body — via {@link requestAt}. The request body is captured at call time because `ky`
 * cancels the request body stream once the call settles.
 */
import { vi } from 'vitest';

/** Request bodies captured at fetch-call time (ky cancels the request body once the call settles). */
const capturedBodies = new WeakMap<Request, string>();

/**
 * Record a request's body text at call time so assertions can read it after the call has settled.
 *
 * @sideEffect Reads (clones) the request body stream and writes to the module-level capture map.
 */
async function captureBody(request: Request): Promise<void> {
    if (request.body) {
        capturedBodies.set(request, await request.clone().text());
    }
}

/** A single canned response for a `fetch` double. */
export interface StubResponse {
    readonly status: number;
    readonly body?: unknown;
    readonly headers?: Record<string, string>;
}

/**
 * A `fetch` double that returns a single canned response and records the call.
 *
 * @sideEffect Returns a `vi.fn` that records calls and captures request bodies.
 */
export function stubFetch(status: number, body?: unknown, headers: Record<string, string> = {}): typeof fetch {
    const init = body === undefined ? undefined : JSON.stringify(body);

    return vi.fn(async (request: Request) => {
        await captureBody(request);

        return new Response(init, { status, headers });
    }) as unknown as typeof fetch;
}

/**
 * A `fetch` double that returns a queued sequence of responses (one per call); the last entry repeats
 * once the queue is exhausted.
 *
 * @sideEffect Returns a `vi.fn` that records calls and captures request bodies.
 */
export function sequenceFetch(responses: readonly StubResponse[]): typeof fetch {
    let i = 0;

    return vi.fn(async (request: Request) => {
        await captureBody(request);
        const r = responses[Math.min(i, responses.length - 1)]!;
        i += 1;

        return new Response(r.body === undefined ? undefined : JSON.stringify(r.body), {
            status: r.status,
            headers: r.headers ?? {},
        });
    }) as unknown as typeof fetch;
}

/** A `fetch` double that rejects with the given error, modeling a transport/network failure. */
export function rejectingFetch(error: Error): typeof fetch {
    return vi.fn(async () => {
        throw error;
    }) as unknown as typeof fetch;
}

/**
 * A `fetch` double that NEVER settles — no response, no error, no FIN — modeling a hung connection: an ALB
 * target draining mid-deploy, a Fargate cold start, a stalled query, or a mobile network handoff that drops
 * the socket without an RST. Deliberately ignores the abort signal, so the only thing that can end the wait
 * is the client's OWN timeout; a client without one waits forever.
 *
 * @sideEffect Returns a `vi.fn` that records calls and captures request bodies.
 */
export function hangingFetch(): typeof fetch {
    return vi.fn(async (request: Request) => {
        await captureBody(request);

        return new Promise<Response>(() => undefined);
    }) as unknown as typeof fetch;
}

/** The recorded `fetch` calls; ky invokes the injected fetch with a `Request` as the first argument. */
export function callsOf(fetchMock: typeof fetch): [Request, ...unknown[]][] {
    return (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls as [Request, ...unknown[]][];
}

/** The observable request the fake fetch received on its Nth call (0-based): URL, method, headers, body. */
export interface ObservedRequest {
    readonly url: string;
    readonly method: string;
    readonly headers: Headers;
    readonly body: string | undefined;
}

/** Extract the observable request (URL, method, headers, captured body) from a fake fetch's Nth call. */
export function requestAt(fetchMock: typeof fetch, index = 0): ObservedRequest {
    const request = callsOf(fetchMock)[index]![0];

    return { url: request.url, method: request.method, headers: request.headers, body: capturedBodies.get(request) };
}
