/**
 * The `external_id` wait is the difference between a run that seeds a world and a run that reports a wall
 * of unrelated `401`s. These assertions pin the two properties that matter: it RETURNS the claim as soon as
 * it exists, and it THROWS — never resolves empty — when it does not.
 */
import { describe, expect, it, vi } from 'vitest';

import { awaitExternalId } from '../src/externalId.js';

/** A clock that advances by `step` on every read, so a deadline is reached deterministically. */
const steppingClock = (step: number): (() => number) => {
    let t = 0;

    return () => {
        const now = t;
        t += step;

        return now;
    };
};

const options = (read: () => Promise<string | null | undefined>, clockStep = 0) => ({
    deadlineMs: 100,
    pollMs: 1,
    read,
    now: steppingClock(clockStep),
    sleep: async (): Promise<void> => undefined,
});

describe('awaitExternalId', () => {
    it('returns the claim on the first read when the webhook has already landed', async () => {
        const read = vi.fn().mockResolvedValue('01J0K6000000000000000000K6');

        await expect(awaitExternalId('a@example.com', options(read))).resolves.toBe('01J0K6000000000000000000K6');
        expect(read).toHaveBeenCalledTimes(1);
    });

    it('keeps polling until the backfill lands', async () => {
        const read = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(undefined).mockResolvedValue('ulid');

        await expect(awaitExternalId('a@example.com', options(read))).resolves.toBe('ulid');
        expect(read).toHaveBeenCalledTimes(3);
    });

    it('treats an EMPTY STRING as absent — a blank claim authorizes nothing', async () => {
        const read = vi.fn().mockResolvedValueOnce('').mockResolvedValue('ulid');

        await expect(awaitExternalId('a@example.com', options(read))).resolves.toBe('ulid');
    });

    it('THROWS at the deadline, naming the two causes worth checking first', async () => {
        const read = vi.fn().mockResolvedValue(null);

        // ⛔ Never resolves `undefined`. A caller that proceeded would 401 on every subsequent call and the
        // run would report the symptom thirty-five times instead of the cause once.
        await expect(awaitExternalId('subject@example.com', options(read, 60))).rejects.toThrow(
            /subject@example\.com still has no external_id[\s\S]*ADR-0007 nightly stop window/,
        );
    });

    it('reads at least once even when the deadline has already passed', async () => {
        const read = vi.fn().mockResolvedValue('ulid');

        // The clock jumps past the deadline immediately; a loop that checked the deadline FIRST would throw
        // without ever asking, and would fail a run whose user was ready all along.
        await expect(awaitExternalId('a@example.com', options(read, 1_000))).resolves.toBe('ulid');
    });
});
