/**
 * The VENDOR contract `logger.error`'s routing rests on — measured against the real SDK, not a mock.
 *
 * ⛔ WHY A SECOND SUITE WHEN `logger.test.ts` ALREADY COVERS THE ROUTING. That one mocks
 * `@sentry/aws-serverless`, so it proves this package calls `Sentry.logger.error` correctly and can prove
 * nothing about what the SDK then does. Three vendor behaviours are load-bearing from U22a step 2 onward,
 * and all three are invisible from behind a mock:
 *
 * - `Sentry.logger.error` emits only when `enableLogs` is on. `reportErrorLine` answers "Sentry was
 *   initialised", never "the SDK will emit" — so if this ever stops producing an envelope, `logger.error`
 *   suppresses its stdout write for a line that goes nowhere. Both sinks drop it, and the symptom is an
 *   absence of error logs, which is what a healthy quiet system looks like.
 * - `beforeSendLog` is the ONLY scrub on this path, and it is OUR shared `scrubLog`. It assumes the SDK
 *   hands it `{ level, message, attributes }`. That assumption is a guess about a vendor's internals until
 *   something runs it.
 * - A denied key must not survive into the envelope — the property ADR-0027 is actually about. Asserting
 *   that `beforeSendLog` was *called* would not show it, because a hook may run and still be ignored.
 *
 * ⚠️ This is the `queueEscalation.ts` precedent: a claim about a dependency's behaviour is settled by
 * measuring the dependency, in the unit tier, because no external process is involved.
 */
import { afterEach, describe, expect, it } from 'vitest';
import * as Sentry from '@sentry/aws-serverless';
import { scrubLog } from '@kitchensink/observability-scrubbers';

/** Every envelope the SDK handed to the transport, already JSON-shaped. */
type CapturedEnvelope = readonly unknown[];

const envelopes: CapturedEnvelope[] = [];

/**
 * Initialise the SDK exactly as `initObservability` does, with the network replaced by a capture.
 *
 * ⚠️ The options mirrored here are the ones under test; any drift between this and `initObservability`
 * is caught by `observability.test.ts`, which asserts that function's `Sentry.init` argument directly.
 *
 * @sideEffect Configures the global Sentry client.
 */
function initCapturing(): void {
    Sentry.init({
        dsn: 'https://k@o1.ingest.sentry.io/1',
        enableLogs: true,
        sendDefaultPii: false,
        beforeSendLog: scrubLog,
        transport: () => ({
            send: async (envelope: CapturedEnvelope) => {
                envelopes.push(JSON.parse(JSON.stringify(envelope)) as CapturedEnvelope);

                return {};
            },
            flush: async () => true,
        }),
    });
}

/** The log items across every captured envelope. */
function capturedLogItems(): Array<Record<string, unknown>> {
    const items: Array<Record<string, unknown>> = [];

    for (const envelope of envelopes) {
        for (const entry of (envelope[1] ?? []) as Array<[{ type?: string }, { items?: unknown[] }]>) {
            if (entry[0]?.type === 'log') {
                items.push(...((entry[1]?.items ?? []) as Array<Record<string, unknown>>));
            }
        }
    }

    return items;
}

describe('the Sentry log contract the error route depends on', () => {
    afterEach(async () => {
        await Sentry.flush(2_000);
        envelopes.length = 0;
        await Sentry.close(2_000);
    });

    it('⛔ emits a LOG envelope — the thing reportErrorLine promises the caller and cannot verify', async () => {
        initCapturing();

        Sentry.logger.error('verification verdict write failed', { verificationKey: 'k-1' });
        await Sentry.flush(2_000);

        const [item] = capturedLogItems();

        expect(item).toBeDefined();
        expect(item?.['body']).toBe('verification verdict write failed');
        expect(item?.['level']).toBe('error');
    });

    it('⛔ applies OUR scrubLog to it — a denied key does not reach the envelope', async () => {
        initCapturing();

        Sentry.logger.error('account-erasure-worker: could not record job error', {
            email: 'someone@example.com',
            ownerId: '01JQBX8Z0000000000000000',
            jobId: 'j-7',
        });
        await Sentry.flush(2_000);

        const attributes = capturedLogItems()[0]?.['attributes'] as Record<string, { value?: unknown }>;

        expect(attributes?.['jobId']?.value).toBe('j-7');
        expect(attributes?.['email']?.value).not.toBe('someone@example.com');
        expect(attributes?.['ownerId']?.value).not.toBe('01JQBX8Z0000000000000000');
    });

    it("⚠️ hands the hook `{ level, message, attributes }` — the shape scrubLog's signature assumes", async () => {
        const seen: Array<Record<string, unknown>> = [];

        Sentry.init({
            dsn: 'https://k@o1.ingest.sentry.io/1',
            enableLogs: true,
            beforeSendLog: (log) => {
                seen.push(log as unknown as Record<string, unknown>);

                return log;
            },
            transport: () => ({ send: async () => ({}), flush: async () => true }),
        });

        Sentry.logger.error('shape probe', { jobId: 'j-8' });
        await Sentry.flush(2_000);

        expect(seen[0]).toMatchObject({ level: 'error', message: 'shape probe' });
        expect((seen[0]?.['attributes'] as Record<string, unknown>)?.['jobId']).toBe('j-8');
    });
});
