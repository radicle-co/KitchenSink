import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import * as Sentry from '@sentry/aws-serverless';

import { runIdentityQueueCheck } from '../../src/handlers/queueCheck.js';
import { checkInQueueCheck } from '../../src/common/queueEscalation.js';

/**
 * The cron check-in, through the REAL Sentry SDK to the envelope it would send.
 *
 * ⛔ The unit suites pass a fake `captureCheckIn` and read back the object they were handed. That cannot show
 * what the SDK actually puts on the wire, or that a stage which must not check in sends NOTHING. So this suite
 * captures the serialized envelope with a recording transport and asserts on `monitor_config` itself.
 *
 * ⛔ REWRITTEN (owner ruling 2026-10-12). The sandbox used to upsert an awake-hours crontab (9-23 in
 * New York time) and stay silent inside ADR-0007's window. The window's clock is deleted and the sandbox starts
 * only by hand, so it is down — and silent — by default: a monitor on its silence would alarm forever. Only
 * prod checks in. Delete the `*-queue-check-sandbox` monitors in Sentry.
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
    it('⛔ sandbox sends NO check-in and upserts no monitor', async () => {
        checkInQueueCheck('sandbox');
        await Sentry.flush();

        expect(sentMonitorConfigs()).toEqual([]);
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
     * ⛔ The whole run, not just the helper: a finished check on the sandbox sends nothing, one on prod checks in.
     * There is no hour that changes either answer, because there is no clock in the path.
     */
    it('⛔ a finished sandbox check sends no check-in; a finished prod check sends one', async () => {
        const deps = {
            counts: async () => ({
                unappliedStatusChanges: 0,
                owedHandleSyncs: 0,
                failedHandleSyncs: 0,
                oldestConvergenceSeconds: 0,
                oldestHandleSyncSeconds: 0,
            }),
            depth: async () => ({ visible: 0, inFlight: 0, deadLettered: 0 }),
            escalate: () => undefined,
        };

        await runIdentityQueueCheck({
            ...deps,
            stage: 'sandbox',
            checkIn: () => {
                checkInQueueCheck('sandbox');
            },
        });
        await Sentry.flush();
        expect(sentMonitorConfigs()).toHaveLength(0);

        await runIdentityQueueCheck({
            ...deps,
            stage: 'prod',
            checkIn: () => {
                checkInQueueCheck('prod');
            },
        });
        await Sentry.flush();
        expect(sentMonitorConfigs()).toHaveLength(1);
    });
});
