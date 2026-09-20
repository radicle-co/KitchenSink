import { beforeEach, describe, expect, it, vi } from 'vitest';

const { captureCheckIn, captureMessage, withScope } = vi.hoisted(() => ({
    captureCheckIn: vi.fn(),
    captureMessage: vi.fn(),
    withScope: vi.fn(),
}));

vi.mock('@sentry/nestjs', () => ({ captureCheckIn, captureMessage, withScope }));

import { DEFAULT_REAP_INTERVAL_MS } from '../../worker/reapInterval.js';
import { checkInQueueCheck, QUEUE_CHECK_INTERVAL_MINUTES } from '../queueEscalation.js';

/**
 * ⛔ THE WIRING, which is all this service's own file does. The escalation BEHAVIOUR is one implementation in
 * `@kitchensink/queue-check` with one suite; what a copy-paste of a sibling's file would get wrong is the two
 * values passed to it — this service's name and its cadence.
 */
beforeEach(() => {
    vi.clearAllMocks();
});

describe('food is wired to its own identity and its own cadence', () => {
    it('⛔ checks in under food-service, not a sibling', () => {
        checkInQueueCheck('prod');

        expect(captureCheckIn.mock.calls[0]?.[0]).toEqual({
            monitorSlug: 'food-service-queue-check-prod',
            status: 'ok',
        });
    });

    /**
     * ⛔ THE REAPER'S TICK, derived rather than written down twice. Food's check has no schedule of its own —
     * it rides the drainer's timer, which is what makes its silence the DRAINER's dead-man signal — so a
     * monitor expecting a different cadence would report a miss every interval for a healthy drainer.
     */
    it('⛔ expects a check-in on the reaper’s cadence, read from the reaper’s own constant', () => {
        expect(QUEUE_CHECK_INTERVAL_MINUTES).toBe(Math.max(1, Math.round(DEFAULT_REAP_INTERVAL_MS / 60_000)));

        checkInQueueCheck('sandbox');

        expect(captureCheckIn.mock.calls[0]?.[1]).toEqual(
            expect.objectContaining({
                schedule: { type: 'interval', value: QUEUE_CHECK_INTERVAL_MINUTES, unit: 'minute' },
            }),
        );
    });

    it('⛔ does not check in from a preview, whose monitor would outlive its stack', () => {
        checkInQueueCheck('pr-91');

        expect(captureCheckIn).not.toHaveBeenCalled();
    });
});
