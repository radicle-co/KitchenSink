/**
 * `lineProgressOf` — what a pending line is doing, read from facts the pipeline already records (plan 2026-10-15-011,
 * owner ruling 2026-10-13: "what step we are in and what we are currently processing").
 *
 * A table over the phase table in the plan, with every boundary on BOTH sides, because each boundary mirrors a rule
 * somewhere else: the lease is `claimLine`'s refusal, the stall threshold is two re-offers of the queue.
 */
import { describe, expect, it } from 'vitest';

import type { ParseLineDelivery } from '@kitchensink/recipe-core/parsing/parse-line-delivery';

import { lineIsOrphaned, lineProgressOf, type LineProgressFacts } from '../lineProgress.js';

/** Small, distinct numbers, so a test that passed by reading the wrong field would show it. */
const DELIVERY: ParseLineDelivery = { leaseSeconds: 10, visibilityTimeoutSeconds: 12, stallSeconds: 24 };

function pending(overrides: Partial<LineProgressFacts> = {}): LineProgressFacts {
    return { status: 'pending', attempts: 0, claimAgeSeconds: null, ...overrides };
}

describe('lineProgressOf', () => {
    it.each([
        { why: 'never claimed, the paste moving', facts: pending(), quiet: 0, phase: 'queued' },
        {
            why: 'never claimed, just inside the stall threshold',
            facts: pending(),
            quiet: 24,
            phase: 'queued',
        },
        {
            why: 'the first delivery holds the claim',
            facts: pending({ attempts: 1, claimAgeSeconds: 3 }),
            quiet: 3,
            phase: 'reading',
        },
        {
            why: 'the first claim at exactly the lease (claimLine still refuses a duplicate)',
            facts: pending({ attempts: 1, claimAgeSeconds: 10 }),
            quiet: 10,
            phase: 'reading',
        },
        {
            why: 'a second delivery holds the claim',
            facts: pending({ attempts: 2, claimAgeSeconds: 1 }),
            quiet: 1,
            phase: 'retrying',
        },
        {
            why: 'a later delivery holds the claim',
            facts: pending({ attempts: 7, claimAgeSeconds: 10 }),
            quiet: 10,
            phase: 'retrying',
        },
        {
            why: 'the claim lapsed just past the lease, no new one yet',
            facts: pending({ attempts: 1, claimAgeSeconds: 10.001 }),
            quiet: 10.001,
            phase: 'delayed',
        },
        {
            why: 'between later attempts',
            facts: pending({ attempts: 3, claimAgeSeconds: 20 }),
            quiet: 20,
            phase: 'delayed',
        },
        {
            why: 'a lapsed claim at exactly the stall threshold is still only delayed',
            facts: pending({ attempts: 1, claimAgeSeconds: 24 }),
            quiet: 24,
            phase: 'delayed',
        },
        {
            why: 'nothing in the paste has moved past the threshold, after a claim',
            facts: pending({ attempts: 1, claimAgeSeconds: 24.001 }),
            quiet: 24.001,
            phase: 'stalled',
        },
        {
            why: 'nothing in the paste has moved past the threshold, never claimed',
            facts: pending(),
            quiet: 25,
            phase: 'stalled',
        },
        {
            why: 'a lapsed claim on a line whose siblings keep landing is delayed, not stalled',
            facts: pending({ attempts: 2, claimAgeSeconds: 600 }),
            quiet: 5,
            phase: 'delayed',
        },
        {
            why: 'a held claim wins even when the reported quiet says otherwise',
            facts: pending({ attempts: 1, claimAgeSeconds: 2 }),
            quiet: 100,
            phase: 'reading',
        },
    ] as const)('$why → $phase', ({ facts, quiet, phase }) => {
        expect(lineProgressOf(facts, quiet, DELIVERY)).toBe(phase);
    });

    it.each(['parsed', 'unparseable', 'failed_retryable'] as const)(
        'a %s line is doing nothing, whatever its claim facts say',
        (status) => {
            expect(lineProgressOf({ status, attempts: 4, claimAgeSeconds: 1 }, 1, DELIVERY)).toBeNull();
            expect(lineProgressOf({ status, attempts: 0, claimAgeSeconds: null }, 1_000, DELIVERY)).toBeNull();
        },
    );

    it('reads the shipped delivery numbers when none are given', () => {
        // 151 s is past the shipped 150 s lease and inside the 360 s stall threshold.
        expect(lineProgressOf(pending({ attempts: 1, claimAgeSeconds: 150 }), 150)).toBe('reading');
        expect(lineProgressOf(pending({ attempts: 1, claimAgeSeconds: 151 }), 151)).toBe('delayed');
        expect(lineProgressOf(pending(), 361)).toBe('stalled');
    });
});

/**
 * `lineIsOrphaned` — the lines "Try again" re-drives although they are not `failed_retryable`: pending, NEVER claimed,
 * in a paste quiet past the stall threshold. The commit-then-enqueue gap (process death after the rows commit, before
 * the messages are sent) leaves exactly those. A claimed line is in the queue's hands (SQS redelivers it), so it is
 * NOT orphaned however long it has been quiet.
 */
describe('lineIsOrphaned', () => {
    it.each([
        { why: 'never claimed, quiet past the threshold', facts: pending(), quiet: 24.001, orphaned: true },
        { why: 'never claimed, exactly at the threshold', facts: pending(), quiet: 24, orphaned: false },
        { why: 'never claimed, the paste moving', facts: pending(), quiet: 0, orphaned: false },
        {
            why: 'claimed once and lapsed — SQS redelivers it',
            facts: pending({ attempts: 1, claimAgeSeconds: 600 }),
            quiet: 600,
            orphaned: false,
        },
        {
            why: 'claimed with attempts unrecorded (a row from before migration 0046)',
            facts: pending({ attempts: 0, claimAgeSeconds: 600 }),
            quiet: 600,
            orphaned: false,
        },
    ] as const)('$why → $orphaned', ({ facts, quiet, orphaned }) => {
        expect(lineIsOrphaned(facts, quiet, DELIVERY)).toBe(orphaned);
    });

    it.each(['parsed', 'unparseable', 'failed_retryable', 'withdrawn'] as const)(
        'a %s line is never orphaned',
        (status) => {
            expect(lineIsOrphaned({ status, attempts: 0, claimAgeSeconds: null }, 1_000, DELIVERY)).toBe(false);
        },
    );
});
