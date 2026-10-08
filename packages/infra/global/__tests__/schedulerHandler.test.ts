// @vitest-environment node
/**
 * The Lambda entrypoint fails its invocation when a run records an error, so Lambda's `Errors` metric (and the
 * scheduler's failed-run alarm) sees a refused start instead of a success (Oct 6–7 2026).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { isSchedulerRunFailedError, type SchedulerSummary } from '../lib/sandbox-scheduler/scheduler.js';

const { runSchedulerAction } = vi.hoisted(() => ({ runSchedulerAction: vi.fn() }));

vi.mock('../lib/sandbox-scheduler/scheduler.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../lib/sandbox-scheduler/scheduler.js')>()),
    runSchedulerAction,
}));

const { handler } = await import('../src/sandbox-scheduler/handler.js');

const summary = (errors: string[]): SchedulerSummary => ({
    action: 'start',
    rds: { acted: [], skipped: [] },
    ecs: { acted: [], skipped: [] },
    nat: { acted: [], skipped: [] },
    errors,
});

beforeEach(() => {
    runSchedulerAction.mockReset();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

describe('the scheduler handler', () => {
    it('returns the summary of a clean run', async () => {
        runSchedulerAction.mockResolvedValue(summary([]));

        await expect(handler({ action: 'start' })).resolves.toEqual(summary([]));
    });

    it('⛔ fails the invocation when the database start was refused', async () => {
        runSchedulerAction.mockResolvedValue(summary(['rds start db: InsufficientDBInstanceCapacity']));
        let thrown: unknown;

        try {
            await handler({ action: 'start' });
        } catch (error) {
            thrown = error;
        }

        expect(isSchedulerRunFailedError(thrown)).toBe(true);
    });
});
