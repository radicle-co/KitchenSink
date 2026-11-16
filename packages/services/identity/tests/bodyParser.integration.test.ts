/**
 * The body parser's refusals over a real HTTP listener: identity parses its own JSON (`src/config/httpSetup.ts`), so a
 * refusal wears the published envelope, carries CORS, and never echoes the caller's text. Booted by
 * `support/identityApp.ts`, which applies the same HTTP setup `main.ts` does, with `pg` and SQS mocked (no database).
 *
 * Route: `PATCH /api/v1/users/me` (a JSON-body route), authenticated through the dev-auth bypass. A refused body must
 * never reach a handler, so the mocked pool must record no query.
 *
 * | Refusal                         | Status | Code                     |
 * | ------------------------------- | ------ | ------------------------ |
 * | a 150 kB body (limit 100 kB)    | 413    | `PAYLOAD_TOO_LARGE`      |
 * | malformed JSON                  | 400    | `BAD_REQUEST`            |
 * | an unsupported content-encoding | 415    | `UNSUPPORTED_MEDIA_TYPE` |
 *
 * `BAD_REQUEST`, not recipe's `VALIDATION_FAILED`: it is identity's own published code for a rejected body.
 *
 * Before the setup existed, Nest's own parser answered malformed JSON with the parser's message (which quotes the
 * request) and the others as a `500`, because they are `http-errors` objects and not `HttpException`s.
 */
import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { apiErrorSchema } from '@kitchensink/schema-identity';
import type { BootedServiceApp } from '@kitchensink/service-test-harness';

// The identity DatabaseModule builds a `pg` Pool at init and QueueModule constructs an SQS client. Mock both so the
// app boots with no real Postgres / LocalStack; `query` is hoisted so the suite can prove no handler ran.
const { query } = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock('pg', () => {
    class Pool {
        connect = vi.fn();
        query = query;
        end = vi.fn();
        on = vi.fn();
    }

    return { default: { Pool } };
});

vi.mock('@aws-sdk/client-sqs', () => ({
    SQSClient: vi.fn(),
    SendMessageCommand: vi.fn(),
}));

import { bootIdentityApp } from './support/identityApp.js';

const DEV_USER = '01HZZE2EBODYPARSERUSER0000';

/** The origin the harness's `CLERK_AUTHORIZED_PARTIES` admits. */
const ADMITTED = 'http://localhost:3000';

/** A 150 kB JSON body, over the 100 kB limit. */
const OVERSIZED = JSON.stringify({ displayName: 'a'.repeat(150_000) });

/** Malformed JSON whose offending text sits inside the window V8 quotes in its `SyntaxError` message. */
const MALFORMED = '{"t": MARKER}';

describe('the body parser refuses with the published envelope', () => {
    let booted: BootedServiceApp;

    beforeAll(async () => {
        booted = await bootIdentityApp({ devAuthUserId: DEV_USER });
    });

    afterAll(async () => {
        await booted?.close();
    });

    /** PATCH raw text to the viewer's profile, with extra headers. */
    const patch = (body: string, headers: Record<string, string> = {}): Promise<Response> =>
        fetch(`${booted.baseUrl}/api/v1/users/me`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json', ...headers },
            body,
        });

    it('⛔ answers a 150 kB body with 413 PAYLOAD_TOO_LARGE', async () => {
        const response = await patch(OVERSIZED);

        expect(response.status).toBe(413);
        expect(apiErrorSchema.parse(await response.json()).code).toBe('PAYLOAD_TOO_LARGE');
        expect(query).not.toHaveBeenCalled();
    });

    // ⛔ THE CALLER'S TEXT NEVER LEAVES. Nest's own parser hands the `SyntaxError` to `mapExternalException`, which
    // rewrites it into a `BadRequestException` carrying the parser's message, and that message quotes the request.
    it('⛔ answers malformed JSON with 400 BAD_REQUEST, and neither the response nor the log carries its text', async () => {
        const sinks = [
            vi.spyOn(Logger.prototype, 'warn'),
            vi.spyOn(Logger.prototype, 'error'),
            vi.spyOn(console, 'warn').mockImplementation(() => undefined),
            vi.spyOn(console, 'error').mockImplementation(() => undefined),
        ];
        const response = await patch(MALFORMED);
        const text = await response.text();
        const logged = sinks.flatMap((sink) => sink.mock.calls.flat().map(String));

        sinks.forEach((sink) => {
            sink.mockRestore();
        });

        expect(response.status).toBe(400);
        expect(apiErrorSchema.parse(JSON.parse(text)).code).toBe('BAD_REQUEST');
        expect(text).not.toContain('MARKER');
        expect(logged.filter((line) => line.includes('MARKER'))).toEqual([]);
        expect(query).not.toHaveBeenCalled();
    });

    it('⛔ answers an unsupported content-encoding with 415 UNSUPPORTED_MEDIA_TYPE, not a 500', async () => {
        const response = await patch('{"displayName":"MARKER-encoded-body"}', { 'content-encoding': 'x-unknown' });
        const text = await response.text();

        expect(response.status).toBe(415);
        expect(apiErrorSchema.parse(JSON.parse(text)).code).toBe('UNSUPPORTED_MEDIA_TYPE');
        expect(text).not.toContain('MARKER-encoded-body');
        expect(query).not.toHaveBeenCalled();
    });

    // ⛔ A PARSER REFUSAL STILL CARRIES CORS. Express skips every non-error middleware after `next(err)`, so a parser
    // registered before CORS answers a browser with no `access-control-allow-origin`.
    it.each([
        ['a 150 kB body', OVERSIZED, 413],
        ['malformed JSON', MALFORMED, 400],
    ])('⛔ answers %s from an allowed origin with its status and the CORS header', async (_name, body, status) => {
        const response = await patch(body, { origin: ADMITTED });

        expect(response.status).toBe(status);
        expect(response.headers.get('access-control-allow-origin')).toBe(ADMITTED);
    });
});
