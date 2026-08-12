/**
 * `observability/auth-trace.ts` — the `DEBUG_AUTH` trace of the sign-up → auth → DB flow.
 *
 * ⚠️ WHY THE EMISSION IS TESTED AND NOT JUST THE SCRUBBER. This file used to assert only
 * `scrubAuthAttributes`, and the trace was INERT on every stage that has it enabled. Infra sets
 * `DEBUG_AUTH: stage === 'prod' ? '0' : '1'`, so sandbox and every `pr-{N}` run with it ON; on a deployed
 * stage the sink was `Sentry.logger.debug`, and `instrument.ts` installs `beforeSendLog: scrubLog`, whose
 * FIRST statement is `if (log.level === 'debug') return null;`. Every entry the trace produced was therefore
 * discarded before leaving the process — an instrument that cannot fire, which is worse than none, because it
 * reads as coverage: `traceAuth('provision.failed', …)` looks like the flow is observable and it is not.
 *
 * The composed test below is the guard. It runs BOTH halves — the sink `traceAuth` actually calls, and the real
 * `scrubLog` hook the entry must survive — so re-muting the trace from either side turns this file red.
 *
 * @module
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { scrubLog } from '../src/observability/sentry-scrubbers.js';

/** One captured Sentry log call, in the shape `beforeSendLog` receives. */
interface CapturedLog {
    level: string;
    message: string;
    attributes: Record<string, unknown>;
}

const captured: CapturedLog[] = [];

/** Record every level `Sentry.logger` exposes, so a change of sink level is visible rather than silent. */
const record =
    (level: string) =>
    (message: string, attributes: Record<string, unknown> = {}): void => {
        captured.push({ level, message, attributes });
    };

vi.mock('@sentry/nestjs', () => ({
    logger: {
        trace: record('trace'),
        debug: record('debug'),
        info: record('info'),
        warn: record('warn'),
        error: record('error'),
    },
}));

/** Import `auth-trace` FRESH: it reads `STAGE`/`DEBUG_AUTH` once, at module evaluation. */
async function loadTrace(
    env: Record<string, string | undefined>,
): Promise<typeof import('../src/observability/auth-trace.js')> {
    for (const [key, value] of Object.entries(env)) {
        if (value === undefined) {
            delete process.env[key];
        } else {
            process.env[key] = value;
        }
    }

    vi.resetModules();

    return import('../src/observability/auth-trace.js');
}

const originalStage = process.env['STAGE'];
const originalDebugAuth = process.env['DEBUG_AUTH'];

beforeEach(() => {
    captured.length = 0;
});

afterEach(() => {
    process.env['STAGE'] = originalStage ?? '';
    process.env['DEBUG_AUTH'] = originalDebugAuth ?? '';

    if (originalStage === undefined) {
        delete process.env['STAGE'];
    }

    if (originalDebugAuth === undefined) {
        delete process.env['DEBUG_AUTH'];
    }
});

describe('traceAuth emission on a deployed stage', () => {
    // ⛔ THE GUARD. Restore `Sentry.logger.debug` as the sink, or make `scrubLog` drop the level the sink uses,
    // and this fails. Both halves are exercised with the REAL scrubber — no restatement of its policy.
    it('emits an entry that SURVIVES the beforeSendLog scrubber', async () => {
        const { traceAuth } = await loadTrace({ STAGE: 'sandbox', DEBUG_AUTH: '1' });

        traceAuth('provision.failed', { sub: 'user_2abc', outcome: 'failed' });

        expect(captured).toHaveLength(1);

        const entry = captured[0]!;
        const survived = scrubLog({ ...entry });

        expect(survived).not.toBeNull();
        expect(survived?.message).toBe('auth: provision.failed');
    });

    it('does not use the `debug` level, which the scrubber drops unconditionally', async () => {
        const { traceAuth } = await loadTrace({ STAGE: 'sandbox', DEBUG_AUTH: '1' });

        traceAuth('token.verified', { sub: 'user_2abc' });

        expect(captured[0]?.level).not.toBe('debug');
        // Non-vacuity: prove the scrubber really does discard the level this used to use, so the assertion
        // above is protecting against something real.
        expect(scrubLog({ level: 'debug', message: 'auth: token.verified', attributes: {} })).toBeNull();
    });

    it('scrubs PII out of the attributes it emits', async () => {
        const { traceAuth } = await loadTrace({ STAGE: 'sandbox', DEBUG_AUTH: '1' });

        traceAuth('provision.created', { sub: 'user_2abc', email: 'a@b.example', emailIsReal: true });

        expect(captured[0]?.attributes).toEqual({ sub: 'user_2abc', email: '[redacted]', emailIsReal: true });
    });

    it('emits NOTHING when DEBUG_AUTH is off — the flag is the volume control', async () => {
        const { traceAuth } = await loadTrace({ STAGE: 'sandbox', DEBUG_AUTH: undefined });

        traceAuth('token.verified', { sub: 'user_2abc' });

        expect(captured).toHaveLength(0);
    });

    it('emits NOTHING when DEBUG_AUTH is a non-truthy string', async () => {
        const { traceAuth } = await loadTrace({ STAGE: 'sandbox', DEBUG_AUTH: '0' });

        traceAuth('token.verified', { sub: 'user_2abc' });

        expect(captured).toHaveLength(0);
    });

    it('does NOT reach Sentry on a non-deployed stage — local/dev traces go to the `debug` console sink', async () => {
        const { traceAuth } = await loadTrace({ STAGE: 'dev', DEBUG_AUTH: '1' });

        traceAuth('token.verified', { sub: 'user_2abc' });

        expect(captured).toHaveLength(0);
    });
});

describe('scrubAuthAttributes (inlined debug:auth scrub)', () => {
    it('redacts textual PII (email, name, picture, token) but keeps sub + non-PII', async () => {
        const { scrubAuthAttributes } = await loadTrace({ STAGE: 'dev', DEBUG_AUTH: undefined });

        const out = scrubAuthAttributes({
            sub: 'user_x',
            email: 'a@b.com',
            name: 'Jane Doe',
            picture: 'https://x/y.png',
            token: 'tok_1',
            outcome: 'created',
        });

        expect(out).toEqual({
            sub: 'user_x',
            email: '[redacted]',
            name: '[redacted]',
            picture: '[redacted]',
            token: '[redacted]',
            outcome: 'created',
        });
    });

    it('keeps boolean/number flags whose key matches a PII substring', async () => {
        const { scrubAuthAttributes } = await loadTrace({ STAGE: 'dev', DEBUG_AUTH: undefined });

        const out = scrubAuthAttributes({ emailIsReal: true, nameLength: 8 });

        expect(out.emailIsReal).toBe(true);
        expect(out.nameLength).toBe(8);
    });
});
