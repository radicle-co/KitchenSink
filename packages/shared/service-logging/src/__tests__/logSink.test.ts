/**
 * The sink — the ONE place a log line is written, tested against the REAL SDK.
 *
 * ⛔ WHY NOT A MOCK OF `@sentry/nestjs`. The property that matters here is not "we called the SDK", it is
 * "the SDK we called is the one the service initialised". Sentry's carrier is keyed BY SDK VERSION
 * (`__SENTRY__[SDK_VERSION]`), so a second `@sentry/core` on the module graph gives a second carrier and
 * `getClient()` answers `undefined` in this package while the service holds a perfectly good client. Under
 * this sink's own rule that is indistinguishable from "no DSN configured": every error silently falls back
 * to stdout, forever, with nothing failing. A mock cannot see that; importing the SDK through the very
 * specifier `logSink.ts` imports is what proves it.
 *
 * ⛔ AND THE STDOUT ASSERTIONS ARE ABOUT ABSENCE AS MUCH AS PRESENCE. "Instead of stdout, not as well as"
 * is the whole ADR-0042 double-count rule; a suite that only checked the Sentry envelope would pass with
 * the line ALSO on stdout, which is the defect.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Sentry from '@sentry/nestjs';

import { emitLogRecord } from '../logSink.js';

/** Log items the capturing transport received. */
let logItems: Array<Record<string, unknown>> = [];
/** Everything written to the console, by method. */
let written: Array<[string, string]> = [];

/**
 * Initialise a real client whose transport captures instead of sending.
 *
 * @sideEffect Configures the global Sentry client.
 */
function initCapturing(): void {
    Sentry.init({
        dsn: 'https://k@o1.ingest.sentry.io/1',
        enableLogs: true,
        sendDefaultPii: false,
        transport: () => ({
            send: async (envelope: readonly unknown[]) => {
                for (const entry of (envelope[1] ?? []) as Array<[{ type?: string }, { items?: unknown[] }]>) {
                    if (entry[0]?.type === 'log') {
                        logItems.push(...((entry[1]?.items ?? []) as Array<Record<string, unknown>>));
                    }
                }

                return {};
            },
            flush: async () => true,
        }),
    });
}

describe('emitLogRecord', () => {
    beforeEach(() => {
        logItems = [];
        written = [];

        for (const method of ['error', 'info'] as const) {
            vi.spyOn(console, method).mockImplementation((line: unknown) => {
                written.push([method, String(line)]);
            });
        }
    });

    afterEach(async () => {
        vi.restoreAllMocks();
        await Sentry.close(2_000);
        // ⚠️ `close()` flushes and disables the client; it does NOT detach it, and `getClient()` keeps
        // answering it — measured. Without this line the no-client cases would run against the previous
        // case's client and the suite would assert the wrong branch while passing.
        Sentry.getCurrentScope().setClient(undefined);
    });

    it('⛔ WITH a client, an error goes to Sentry and NOT to the console', async () => {
        initCapturing();

        emitLogRecord('error', 'verdict write failed', { verificationKey: 'k-1' });
        await Sentry.flush(2_000);

        expect(logItems[0]?.['body']).toBe('verdict write failed');
        expect(written).toEqual([]);
    });

    it('⛔ WITHOUT a client, the error still reaches the console — the line is never deleted', async () => {
        emitLogRecord('error', 'verdict write failed', { verificationKey: 'k-1' });
        await Sentry.flush(2_000);

        expect(logItems).toEqual([]);
        expect(written).toHaveLength(1);
        expect(written[0]?.[0]).toBe('error');
        expect(JSON.parse(written[0]?.[1] ?? '{}')).toMatchObject({
            level: 'error',
            message: 'verdict write failed',
            verificationKey: 'k-1',
        });
    });

    it('⛔ info and warn stay on the console even WITH a client — they are not worth the quota', async () => {
        initCapturing();

        emitLogRecord('info', 'CORS origin mode: allowlist', { mode: 'allowlist' });
        emitLogRecord('warn', 'schema is behind', { expected: 12 });
        await Sentry.flush(2_000);

        expect(logItems).toEqual([]);
        expect(written.map(([method]) => method)).toEqual(['info', 'info']);
    });

    it('⛔ renders an Error on BOTH paths — neither sink can serialize one', async () => {
        emitLogRecord('warn', 'rename failed', { error: new Error('duplicate key') });
        initCapturing();
        emitLogRecord('error', 'rename failed', { error: new Error('duplicate key') });
        await Sentry.flush(2_000);

        expect(written[0]?.[1]).toContain('duplicate key');
        expect(JSON.stringify(logItems[0])).toContain('duplicate key');
    });

    it('⛔ scrubs the console path, which NOTHING else scrubs', async () => {
        // The Sentry path is scrubbed by each service's `beforeSendLog`. The console path is forwarded by
        // ADR-0042's drain, whose own sanitiser covers five key names and path segments and no more.
        emitLogRecord('warn', 'profile refresh failed', {
            email: 'someone@example.com',
            ownerId: '01JQBX8Z0000000000000000',
            recipeId: 'r-1',
        });

        const line = JSON.parse(written[0]?.[1] ?? '{}') as Record<string, unknown>;

        expect(line['email']).not.toBe('someone@example.com');
        expect(line['ownerId']).not.toBe('01JQBX8Z0000000000000000');
        expect(line['recipeId']).toBe('r-1');
    });

    /**
     * ⛔ A STRING THAT ARRIVED AS FREE TEXT IS SCRUBBED TOO, not only one this sink rendered.
     *
     * ADR-0043 states the rule — render, then `scrubText`, because `scrubAttributes` judges a string AS A
     * WHOLE against an unanchored bearer pattern and never applies the email or Clerk-`sub` patterns to a
     * nested string at all. The first implementation applied it only on the `value instanceof Error` branch,
     * so text that was ALREADY rendered by the caller fell through to exactly the hazard the ADR rules
     * against. Both `ApiExceptionFilter`s did that: `logger.error(line, renderThrowable(exception))`.
     *
     * The two failure directions are asserted separately because they look nothing alike: a token-shaped
     * substring would have replaced the WHOLE stack with `[redacted]` (the operator loses the error), while
     * an email would have survived intact onto a stream ADR-0042's drain forwards off-host.
     */
    it('⛔ scrubs a pre-rendered stack IN PLACE — the trace survives and the secrets do not', async () => {
        const token = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1g';

        emitLogRecord('error', 'GET /recipes -> 500', {
            stack: `Error: refresh failed\n    at handler (app.js:1:1)\n  ${token}  someone@example.com`,
        });

        const stack = (JSON.parse(written[0]?.[1] ?? '{}') as Record<string, string>)['stack'] ?? '';

        expect(stack).toContain('at handler (app.js:1:1)');
        expect(stack).not.toContain(token);
        expect(stack).not.toContain('someone@example.com');
    });

    /**
     * ⛔ THE MESSAGE TOO. `renderLogAttributes` structurally cannot reach it, and the Sentry path scrubs it
     * via `scrubLog` (`log.message = scrubText(log.message)`) — so leaving the console path unscrubbed made
     * this module's own docstring ("the console path is scrubbed HERE, because nothing else does") false for
     * the one field every line has.
     */
    it('⛔ scrubs the MESSAGE on the console path, which the Sentry path already does', async () => {
        emitLogRecord('warn', 'profile refresh failed for someone@example.com', {});

        expect(written[0]?.[1]).not.toContain('someone@example.com');
        expect(written[0]?.[1]).toContain('profile refresh failed');
    });

    /**
     * ⛔ THE TOKEN AN OPERATOR PIVOTS ON MUST MATCH ACROSS THE TWO PRODUCTS. A log and an issue are different
     * products with different scrub paths — the console line is scrubbed here, the issue by `scrubEvent` —
     * and `identity/src/queue/deletionEnqueue.error.ts` emits BOTH for the same ids in one function. Once
     * this sink began scrubbing every string, an id-keyed Clerk `sub` met `scrubText` (which replaces a sub
     * inline) and then `scrubAttributes` (which replaces it by key), and hashing `anon_<h1>` again gave
     * `anon_<h2>`. Nothing leaked and nothing failed; the two records simply stopped naming the same person.
     *
     * The fix is in `pseudonymizeId`, but the assertion belongs HERE, because this is the only place where
     * the two scrub paths meet a value and can be compared.
     */
    it('⛔ pseudonymizes a Clerk sub to the SAME token the issue path uses', async () => {
        const { scrubAttributes } = await import('@kitchensink/observability-scrubbers');
        const sub = 'user_2NNEqL2nrIRdJ194ndJqAHwEfxC';

        emitLogRecord('error', 'closure enqueue failed', { identityId: sub, event: 'closure' });

        const line = JSON.parse(written[0]?.[1] ?? '{}') as Record<string, unknown>;

        expect(line['identityId']).toBe(scrubAttributes({ identityId: sub })['identityId']);
        expect(line['identityId']).not.toBe(sub);
    });

    it('stamps every console line with a level and an ISO timestamp so the drain need not guess', async () => {
        emitLogRecord('info', 'listening', {});

        const line = JSON.parse(written[0]?.[1] ?? '{}') as { level?: string; timestamp?: string };

        expect(line.level).toBe('info');
        expect(new Date(line.timestamp ?? '').toISOString()).toBe(line.timestamp);
    });

    /**
     * ⚠️ THE MESSAGE IS BOUNDED TOO. `renderLogAttributes` cannot reach it, so the bound has to be applied
     * here separately — and a changed line with no test is how the attribute path would drift away from the
     * message path without anything saying so.
     */
    it('bounds an oversized message before scrubbing it', async () => {
        emitLogRecord('warn', `${'a'.repeat(6_000)}@`, {});

        const line = JSON.parse(written[0]?.[1] ?? '{}') as Record<string, string>;

        expect(line['message']?.length).toBeLessThan(5_000);
        expect(line['message']).toContain('[truncated]');
    });

    it('⚠️ never lets an attribute take down its caller — a cyclic bag still produces a line', async () => {
        const cyclic: Record<string, unknown> = { id: 'j-1' };
        cyclic['self'] = cyclic;

        expect(() => emitLogRecord('warn', 'stuck job', { job: cyclic })).not.toThrow();
        expect(written[0]?.[1]).toContain('j-1');
    });
});
