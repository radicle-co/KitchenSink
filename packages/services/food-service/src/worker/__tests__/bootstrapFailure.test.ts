/**
 * The worker's bootstrap failure path: it must END the process, not only mark it failed.
 *
 * `main.ts` checks three sessions out of the pool for the process's whole life (lock, listen, backstop). A
 * `start()` that rejected after taking the drainer lock used to set `process.exitCode = 1` and return, and those
 * sessions kept the event loop alive: a task holding the single-drainer lock with no tick, no metrics, no
 * check-in and no health check for ECS to fail. Exiting closes the sessions, which frees the advisory lock, and
 * ECS replaces the task.
 */
import { describe, expect, it, vi } from 'vitest';

import { exitOnBootstrapFailure } from '../bootstrapFailure.js';

describe('exitOnBootstrapFailure', () => {
    it('⛔ logs one structured line and exits the process non-zero', () => {
        const log = vi.fn();
        const exit = vi.fn();

        exitOnBootstrapFailure(new Error('reap failed: connection reset'), { log, exit });

        expect(exit).toHaveBeenCalledWith(1);
        expect(log).toHaveBeenCalledTimes(1);
        expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toStrictEqual({
            level: 'error',
            message: 'bootstrap-failed',
            error: 'Error: reap failed: connection reset',
        });
    });

    it('logs before it exits, so the reason is never lost to the exit', () => {
        const order: string[] = [];

        exitOnBootstrapFailure('boom', {
            log: () => order.push('log'),
            exit: () => order.push('exit'),
        });

        expect(order).toStrictEqual(['log', 'exit']);
    });
});
