/**
 * Unit tests for the identity {@link ApiExceptionFilter} (ARCH-PS-2). Proves the composed behaviour:
 *
 * - unexpected throwables are captured to Sentry AND rendered as a generic, detail-free 500;
 * - `HttpException` control flow is NOT captured (unchanged capture policy) but IS reshaped into the
 *   shared `{ code, message, details? }` envelope (code derived from the HTTP status);
 * - a VALIDATION rejection keeps its per-field diagnostics under `details.fields` — the claim the
 *   published contract makes (`contract/openapi.ts`, `src/common/api-error.schema.ts`).
 *
 * ⚠️ THE VALIDATION CASES DRIVE THE REAL PIPE, not a hand-shaped body, and that is the point of them.
 * When the DTOs moved from `class-validator` to `nestjs-zod` (CODING_STANDARDS §15.2), the exception body
 * changed from `{ message: string[] }` to `{ message: 'Validation failed', errors: ZodIssue[] }`. The filter
 * only lifted an ARRAY `message`, so every field name and every issue was silently dropped and the only
 * validated write route in the service began answering `{"code":"BAD_REQUEST","message":"Validation failed"}` —
 * while three artifacts kept promising `details.fields`. The old test could not see it: it asserted a
 * hand-built class-validator body that no identity route can produce any more. So these cases obtain their
 * exception by asking `ZodValidationPipe` to reject a real `PatchUserMeBodyDto` body — if `nestjs-zod` ever
 * moves the issues off `errors` again, this file fails instead of the wire quietly degrading.
 *
 * NOTE: identity's vitest config only discovers the tests directory, so this unit test lives here
 * (rather than co-located under src) so it actually runs.
 */
import {
    BadRequestException,
    ForbiddenException,
    HttpException,
    NotFoundException,
    ServiceUnavailableException,
} from '@nestjs/common';
import type { ArgumentMetadata, ArgumentsHost } from '@nestjs/common';
import { ZodValidationPipe } from 'nestjs-zod';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const captureException = vi.fn();
vi.mock('@sentry/nestjs', () => ({ captureException: (...args: unknown[]) => captureException(...args) }));

import { ApiExceptionFilter } from '../src/common/filters/api-exception.filter.js';
import { PatchUserMeBodyDto } from '../src/users/dto/user.dto.js';

interface Captured {
    status?: number;
    body?: unknown;
}

function makeHost(): { host: ArgumentsHost; captured: Captured } {
    const captured: Captured = {};
    const res = {
        status(code: number) {
            captured.status = code;

            return res;
        },
        json(body: unknown) {
            captured.body = body;

            return res;
        },
    };
    const host = {
        switchToHttp: () => ({ getResponse: <T>() => res as unknown as T }),
    } as unknown as ArgumentsHost;

    return { host, captured };
}

/** The globally-bound pipe and the real `PATCH /api/v1/users/me` body metadata, exactly as Nest invokes it. */
const validationPipe = new ZodValidationPipe();
const patchBodyMeta: ArgumentMetadata = { type: 'body', metatype: PatchUserMeBodyDto, data: '' };

/**
 * The exception the PRODUCTION pipeline throws for `body` on `PATCH /api/v1/users/me`. Fails loudly when the
 * body is accepted, so a case can never silently assert nothing.
 */
function validationRejectionFor(body: unknown): unknown {
    try {
        validationPipe.transform(body, patchBodyMeta);
    } catch (error) {
        return error;
    }

    throw new Error('expected ZodValidationPipe to reject this body, but it was accepted');
}

describe('ApiExceptionFilter (identity)', () => {
    const filter = new ApiExceptionFilter();

    beforeEach(() => {
        captureException.mockClear();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('maps NotFoundException → 404 { code, message } and does NOT capture to Sentry', () => {
        const { host, captured } = makeHost();

        filter.catch(new NotFoundException('User not found'), host);

        expect(captured.status).toBe(404);
        expect(captured.body).toEqual({ code: 'NOT_FOUND', message: 'User not found' });
        expect(captureException).not.toHaveBeenCalled();
    });

    it('maps ForbiddenException → 403 with the FORBIDDEN code', () => {
        const { host, captured } = makeHost();

        filter.catch(new ForbiddenException('User is suspended'), host);

        expect(captured.status).toBe(403);
        expect(captured.body).toEqual({ code: 'FORBIDDEN', message: 'User is suspended' });
    });

    // ---- validation rejections: the body the service ACTUALLY sends, via the real pipe ----

    it('lifts every zod issue of a real pipe rejection into details.fields, named by its field', () => {
        const { host, captured } = makeHost();

        filter.catch(validationRejectionFor({ displayName: 'x'.repeat(101), avatarUrl: 'not-a-url' }), host);

        expect(captured.status).toBe(400);
        expect(captured.body).toEqual({
            code: 'BAD_REQUEST',
            message: 'displayName: Too big: expected string to have <=100 characters, avatarUrl: Invalid URL',
            details: {
                fields: ['displayName: Too big: expected string to have <=100 characters', 'avatarUrl: Invalid URL'],
            },
        });
    });

    // The regression in one assertion: `message` must never collapse back to the bare, diagnostic-free
    // `'Validation failed'` that `nestjs-zod` puts on its exception body — that string is what the profile
    // form was showing the user in place of per-field feedback.
    it('never surfaces the bare "Validation failed" placeholder when there are issues to report', () => {
        const { host, captured } = makeHost();

        filter.catch(validationRejectionFor({ avatarUrl: 'not-a-url' }), host);

        const body = captured.body as { message: string; details?: { fields?: unknown } };

        expect(body.message).not.toBe('Validation failed');
        expect(body.message).toContain('avatarUrl');
        expect(body.details?.fields).toEqual(['avatarUrl: Invalid URL']);
    });

    // `z.strictObject`'s unrecognized-key issue carries an EMPTY path (the object itself failed, not a
    // property), so the field prefix has to be omitted rather than rendered as `': '`.
    it('renders a path-less issue (unknown field) as the bare message, with no empty field prefix', () => {
        const { host, captured } = makeHost();

        filter.catch(validationRejectionFor({ displayName: 'Valid', hacker: 'extra' }), host);

        expect(captured.status).toBe(400);
        expect(captured.body).toEqual({
            code: 'BAD_REQUEST',
            message: 'Unrecognized key: "hacker"',
            details: { fields: ['Unrecognized key: "hacker"'] },
        });
    });

    // An absent body is a 400 rather than the 200 no-op Nest's `ValidationPipe` produced by coercing
    // `undefined` → `{}` (see `tests/e2e/users-validation.e2e.test.ts` for the recorded decision).
    it('reports an absent body as a validation failure naming the expected shape', () => {
        const { host, captured } = makeHost();

        filter.catch(validationRejectionFor(undefined), host);

        expect(captured.status).toBe(400);
        expect((captured.body as { message: string }).message).toContain('expected object');
    });

    // Defensive: an `errors` key with nothing usable in it must not manufacture an empty `details.fields`
    // or a `message` of `''` — it falls back to the envelope's string message.
    it('falls back to the string message when the errors array carries nothing renderable', () => {
        const { host, captured } = makeHost();
        const empty = new BadRequestException({ statusCode: 400, message: 'Validation failed', errors: [] });

        filter.catch(empty, host);

        expect(captured.body).toEqual({ code: 'BAD_REQUEST', message: 'Validation failed' });
    });

    // Nest's OWN body shape for `new HttpException([...])`, which no identity route produces today (there is
    // no `class-validator` left in the service) but which the framework still supports. Retained because
    // dropping the branch would send such a body to `exception.message` — i.e. `'Bad Request'`, losing the
    // very diagnostics this filter exists to preserve. Constructed through the public Nest API, not a
    // hand-shaped internal body, so it asserts the framework contract rather than a guess at it.
    it("preserves Nest's array-message body shape under details.fields", () => {
        const { host, captured } = makeHost();

        filter.catch(new BadRequestException(['name must be a string', 'name should not be empty']), host);

        expect(captured.status).toBe(400);
        expect(captured.body).toEqual({
            code: 'BAD_REQUEST',
            message: 'name must be a string, name should not be empty',
            details: { fields: ['name must be a string', 'name should not be empty'] },
        });
    });

    // ---- a DELIBERATE code in the thrown body must survive ----

    /*
     * ⚠️ REGRESSION. `HealthController.getReadiness` raises
     * `new ServiceUnavailableException({ code: 'NOT_READY', message: 'Database not reachable' })`, and
     * `contract/openapi.ts` publishes that `503` as "Database not reachable (`NOT_READY`)". The filter had no
     * branch for a body that already NAMES its code, so it derived one from the status instead and put
     * `SERVICE_UNAVAILABLE` on the wire — the published document described a code the service never sent.
     *
     * The case generalizes past this one route: a status-keyed derivation cannot distinguish two failures that
     * share a status and need opposite handling, which is the entire reason the envelope carries a code. Food
     * and recipe both had this branch already; identity's absence of it is what made the document wrong here.
     */
    it('keeps a code the thrown body already names, instead of deriving one from the status', () => {
        const { host, captured } = makeHost();

        filter.catch(new ServiceUnavailableException({ code: 'NOT_READY', message: 'Database not reachable' }), host);

        expect(captured.status).toBe(503);
        expect(captured.body).toEqual({ code: 'NOT_READY', message: 'Database not reachable' });
    });

    // The other half of the same branch: a body naming a code but NO message must keep the code and borrow the
    // exception's message, rather than being rejected as "not an envelope" and falling back to a derived code.
    it('keeps an explicit code even when the body carries no message of its own', () => {
        const { host, captured } = makeHost();

        filter.catch(new ForbiddenException({ code: 'ACCOUNT_SUSPENDED' }), host);

        expect(captured.status).toBe(403);
        // `'Forbidden Exception'` is what Nest itself puts on `exception.message` for an object-bodied
        // `ForbiddenException`; the point of the case is the CODE, and that the message is borrowed rather than
        // left empty.
        expect(captured.body).toEqual({ code: 'ACCOUNT_SUSPENDED', message: 'Forbidden Exception' });
    });

    // ⛔ NOT the same case: a body whose `code` is absent, empty or non-string is NOT an envelope, and must
    // still get a status-derived code. Without this, `asExplicitEnvelope` could "pass" by accepting anything.
    it('still derives the code when the body has an empty or non-string code', () => {
        const { host, captured } = makeHost();

        filter.catch(new ForbiddenException({ code: '', message: 'nope' }), host);

        expect(captured.body).toEqual({ code: 'FORBIDDEN', message: 'nope' });
    });

    it('derives HTTP_<status> for an unmapped status and reads a string body', () => {
        const { host, captured } = makeHost();

        filter.catch(new HttpException('teapot', 418), host);

        expect(captured.status).toBe(418);
        expect(captured.body).toEqual({ code: 'HTTP_418', message: 'teapot' });
    });

    it('captures an unexpected error to Sentry and returns a generic 500 with no leaked detail', () => {
        const { host, captured } = makeHost();
        const leaky = new Error('connect ECONNREFUSED 10.0.3.14:5432 password=hunter2');

        filter.catch(leaky, host);

        expect(captureException).toHaveBeenCalledWith(leaky);
        expect(captured.status).toBe(500);
        expect(captured.body).toEqual({ code: 'INTERNAL_ERROR', message: 'Internal server error' });
        expect(JSON.stringify(captured.body)).not.toContain('ECONNREFUSED');
        expect(JSON.stringify(captured.body)).not.toContain('hunter2');
    });
});
