/**
 * The body parser's refusals over a real HTTP listener: food parses its own JSON (`src/config/httpSetup.ts`), so a
 * refusal wears the published envelope, carries CORS, and never echoes the caller's text. Booted by
 * `support/mockedFoodsApi.ts`, which applies the same HTTP setup `main.ts` does. No database.
 *
 * Route: `POST /api/v1/foods` (add by name), authenticated as the `author` principal. The persistence double is empty,
 * so a refused body that reached the controller would touch an unstaged collaborator and answer `500`, not the 4xx.
 *
 * | Refusal                         | Status | Code                     |
 * | ------------------------------- | ------ | ------------------------ |
 * | a 150 kB body (limit 100 kB)    | 413    | `PAYLOAD_TOO_LARGE`      |
 * | malformed JSON                  | 400    | `VALIDATION_FAILED`      |
 * | an unsupported content-encoding | 415    | `UNSUPPORTED_MEDIA_TYPE` |
 *
 * Before the setup existed, Nest's own parser answered malformed JSON with the parser's message (which quotes the
 * request) and the others as a `500`, because they are `http-errors` objects and not `HttpException`s.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@kitchensink/clerk-verify', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@kitchensink/clerk-verify')>();

    return { ...actual, verifyClerkToken: vi.fn() };
});

import { verifyClerkToken } from '@kitchensink/clerk-verify';

import { apiErrorSchema } from '../src/common/apiError.schema.js';
import { bootMockedFoodsApi, principalFor, type MockedFoodsApi } from './support/mockedFoodsApi.js';

const mockVerify = vi.mocked(verifyClerkToken);

/** The origin the harness's `CLERK_AUTHORIZED_PARTIES` admits. */
const ADMITTED = 'https://app.example.com';

const ROUTE = '/api/v1/foods';

/** A 150 kB JSON body, over the 100 kB limit. */
const OVERSIZED = JSON.stringify({ name: 'a'.repeat(150_000) });

/** Malformed JSON whose offending text sits inside the window V8 quotes in its `SyntaxError` message. */
const MALFORMED = '{"t": MARKER}';

describe('the body parser refuses with the published envelope', () => {
    let api: MockedFoodsApi;

    beforeAll(async () => {
        api = await bootMockedFoodsApi({ foodDao: {} });
    });

    afterAll(async () => {
        await api.close();
    });

    beforeEach(() => {
        mockVerify.mockReset();
        mockVerify.mockImplementation(async (token: string) => principalFor(token));
    });

    /** POST raw text as the `author`, optionally from an origin and with extra headers. */
    const post = (body: string, headers: Record<string, string> = {}): Promise<Response> =>
        fetch(`${api.baseUrl}${ROUTE}`, {
            method: 'POST',
            headers: { authorization: 'Bearer author', 'content-type': 'application/json', ...headers },
            body,
        });

    it('⛔ answers a 150 kB body with 413 PAYLOAD_TOO_LARGE', async () => {
        const response = await post(OVERSIZED);

        expect(response.status).toBe(413);
        expect(apiErrorSchema.parse(await response.json()).code).toBe('PAYLOAD_TOO_LARGE');
    });

    // ⛔ THE CALLER'S TEXT NEVER LEAVES. Nest's own parser hands the `SyntaxError` to `mapExternalException`, which
    // rewrites it into a `BadRequestException` carrying the parser's message, and that message quotes the request.
    it('⛔ answers malformed JSON with 400 VALIDATION_FAILED, and neither the response nor the log carries its text', async () => {
        const sinks = (['log', 'info', 'warn', 'error'] as const).map((method) =>
            vi.spyOn(console, method).mockImplementation(() => undefined),
        );
        const response = await post(MALFORMED);
        const text = await response.text();
        const logged = sinks.flatMap((sink) => sink.mock.calls.flat().map(String));

        sinks.forEach((sink) => {
            sink.mockRestore();
        });

        expect(response.status).toBe(400);
        expect(apiErrorSchema.parse(JSON.parse(text)).code).toBe('VALIDATION_FAILED');
        expect(text).not.toContain('MARKER');
        expect(logged.length).toBeGreaterThan(0);
        expect(logged.filter((line) => line.includes('MARKER'))).toEqual([]);
    });

    it('⛔ answers an unsupported content-encoding with 415 UNSUPPORTED_MEDIA_TYPE, not a 500', async () => {
        const response = await post('{"name":"MARKER-encoded-body"}', { 'content-encoding': 'x-unknown' });
        const text = await response.text();

        expect(response.status).toBe(415);
        expect(apiErrorSchema.parse(JSON.parse(text)).code).toBe('UNSUPPORTED_MEDIA_TYPE');
        expect(text).not.toContain('MARKER-encoded-body');
    });

    // ⛔ A PARSER REFUSAL STILL CARRIES CORS. Express skips every non-error middleware after `next(err)`, so a parser
    // registered before CORS answers a browser with no `access-control-allow-origin`.
    it.each([
        ['a 150 kB body', OVERSIZED, 413],
        ['malformed JSON', MALFORMED, 400],
    ])('⛔ answers %s from an allowed origin with its status and the CORS header', async (_name, body, status) => {
        const response = await post(body, { origin: ADMITTED });

        expect(response.status).toBe(status);
        expect(response.headers.get('access-control-allow-origin')).toBe(ADMITTED);
    });
});
