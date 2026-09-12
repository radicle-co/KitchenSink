/**
 * A stand-in for k6's built-in `k6/http`, so the shared session refresher can be unit-tested.
 *
 * `k6/http` exists only inside the k6 binary's Go runtime — there is no npm package to install, so a
 * vitest run cannot resolve the specifier at all. `vitest.config.ts` aliases it here. The stub records
 * calls and replays queued responses; the test drives it entirely.
 */

/** The subset of a k6 `Response` the refresher reads. */
export interface StubResponse {
    readonly status: number;
    json(path: string): unknown;
}

/** One recorded request. */
export interface StubCall {
    readonly url: string;
    readonly params: { readonly headers?: Record<string, string>; readonly tags?: Record<string, string> };
}

export const calls: StubCall[] = [];
const queued: StubResponse[] = [];

/** Queue the response the next `post` will return. */
export function queueResponse(response: StubResponse): void {
    queued.push(response);
}

/** Forget every recorded call and queued response. */
export function reset(): void {
    calls.length = 0;
    queued.length = 0;
}

/** Build a `200 { jwt }` response. */
export function mintedResponse(jwt: string): StubResponse {
    return { status: 200, json: (path) => (path === 'jwt' ? jwt : undefined) };
}

const http = {
    post(url: string, _body: unknown, params: StubCall['params']): StubResponse {
        calls.push({ url, params });

        const next = queued.shift();

        if (next === undefined) {
            throw new Error('k6HttpStub: a post was made with no response queued — the test under-specified it');
        }

        return next;
    },
};

export default http;
