import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import * as Sentry from '@sentry/aws-serverless';

import { runIdentityQueueCheck } from '../../src/handlers/queueCheck.js';
import { checkInQueueCheck } from '../../src/common/queueEscalation.js';

/**
 * The cron check-in, through the REAL Sentry SDK to the envelope it would send.
 *
 * ⛔ The unit suites pass a fake `captureCheckIn` and read back the object they were handed. That cannot show
 * the SDK keeps a crontab schedule and its timezone on the wire — a field it dropped would leave the monitor on
 * whatever schedule it already had — an every-five-minutes interval that reads ADR-0007's window as a dead
 * check. So this suite captures the serialized envelope with a recording transport and asserts on `monitor_config` itself.
 */
/** The envelope shape this suite reads: a header, then `[itemHeader, item]` pairs. The SDK does not export its type. */
type RecordedEnvelope = readonly [unknown, ReadonlyArray<readonly [{ readonly type?: string }, unknown]>];

const sent: RecordedEnvelope[] = [];

/** The `monitor_config` of every check-in item the SDK serialized, in order. */
function sentMonitorConfigs(): unknown[] {
    return sent.flatMap((envelope) =>
        envelope[1]
            .filter(([header]) => header.type === 'check_in')
            .map(([, item]) => (item as { monitor_config?: unknown }).monitor_config),
    );
}

beforeAll(() => {
    Sentry.init({
        dsn: 'https://public@o0.ingest.sentry.io/0',
        defaultIntegrations: false,
        transport: () => ({
            send: async (envelope: unknown) => {
                sent.push(envelope as RecordedEnvelope);

                return {};
            },
            flush: async () => true,
        }),
    });
});

afterAll(async () => {
    await Sentry.close();
});

beforeEach(() => {
    sent.length = 0;
});

describe('the identity queue check-in on the wire', () => {
    it('⛔ sandbox upserts a crontab over its awake hours, in New York time', async () => {
        checkInQueueCheck('sandbox');
        await Sentry.flush();

        expect(sentMonitorConfigs()).toEqual([
            expect.objectContaining({
                schedule: { type: 'crontab', value: '*/5 9-23 * * *' },
                timezone: 'America/New_York',
                checkin_margin: 5,
                failure_issue_threshold: 2,
                recovery_threshold: 1,
            }),
        ]);
    });

    it('prod keeps its every-five-minutes interval', async () => {
        checkInQueueCheck('prod');
        await Sentry.flush();

        const [config] = sentMonitorConfigs();

        expect(config).toEqual(expect.objectContaining({ schedule: { type: 'interval', value: 5, unit: 'minute' } }));
        // The SDK writes the key whether or not it was given one, so the claim is about its value.
        expect((config as { timezone?: unknown }).timezone).toBeUndefined();
    });

    /**
     * ⛔ The two halves of the fix must agree: a run inside the window sends NOTHING (it cannot reach Sentry
     * then anyway), and the monitor above expects nothing then. A run in the awake hours checks in.
     */
    it('⛔ a sandbox run in the nightly window sends no check-in; one at 09:00 New York time does', async () => {
        const deps = {
            stage: 'sandbox',
            counts: async () => ({
                unappliedStatusChanges: 0,
                owedHandleSyncs: 0,
                failedHandleSyncs: 0,
                oldestConvergenceSeconds: 0,
                oldestHandleSyncSeconds: 0,
            }),
            depth: async () => ({ visible: 0, inFlight: 0, deadLettered: 0 }),
            escalate: () => undefined,
            checkIn: () => {
                checkInQueueCheck('sandbox');
            },
        };

        await runIdentityQueueCheck({ ...deps, now: () => new Date('2026-10-05T12:55:00Z') }); // 08:55 EDT
        await Sentry.flush();
        expect(sentMonitorConfigs()).toHaveLength(0);

        await runIdentityQueueCheck({ ...deps, now: () => new Date('2026-10-05T13:00:00Z') }); // 09:00 EDT
        await Sentry.flush();
        expect(sentMonitorConfigs()).toHaveLength(1);
    });
});
