/**
 * The rerun limit: a flow that failed twice on the same head, with the same flow file, on the same platform and
 * device, is refused until the run is started with a problem report reference. Each row names the mutant it kills.
 * The rows for `recordOutcomes` are about what the door hands it; the door's own half is in `rerunDoor.test.ts`
 * and `laneRun.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import {
    EMPTY_RERUN_HISTORY,
    RERUN_HISTORY_DAYS,
    failuresOf,
    recordOutcomes,
    rerunDecision,
    rerunKey,
    type RerunHistory,
} from '../rerunLimit.js';

const NOW = '2026-11-27T10:00:00.000Z';
const DAY_MS = 24 * 60 * 60 * 1000;
const daysBefore = (days: number): string => new Date(Date.parse(NOW) - days * DAY_MS).toISOString();

const KEY = {
    platform: 'ios',
    device: 'iphone',
    flowId: 'recipes/detailCooking',
    head: '1a2b3c4',
    blob: 'blobX',
} as const;
const F = rerunKey(KEY);
const G = rerunKey({ ...KEY, flowId: 'recipes/home' });

/** A history with the given failures per key, last failing at `at`. */
const historyOf = (failures: Readonly<Record<string, number>>, at = NOW): RerunHistory => ({
    version: 1,
    entries: Object.fromEntries(
        Object.entries(failures).map(([key, count]) => [key, { failures: count, lastAt: at, references: [] }]),
    ),
});

const fail = (key: string) => ({ key, failed: true });
const pass = (key: string) => ({ key, failed: false });

describe('rerunKey', () => {
    it('names the platform, device, flow, head and blob, each one (mutant: a part left out)', () => {
        const keys = [
            F,
            rerunKey({ ...KEY, platform: 'android' }),
            rerunKey({ ...KEY, device: 'ipad' }),
            rerunKey({ ...KEY, flowId: 'recipes/home' }),
            rerunKey({ ...KEY, head: '9z9z9z9' }),
            rerunKey({ ...KEY, blob: 'blobY' }),
        ];

        expect(new Set(keys).size).toBe(keys.length);
    });

    it('is the same for the same parts', () => {
        expect(rerunKey({ ...KEY })).toBe(F);
    });

    it('gives an Android key no device, so a stray device does not split it', () => {
        expect(rerunKey({ ...KEY, platform: 'android', device: undefined })).toBe(
            rerunKey({ ...KEY, platform: 'android', device: 'iphone' }),
        );
    });
});

describe('rerunDecision', () => {
    const decide = (history: RerunHistory, keys: readonly string[], reference?: string) =>
        rerunDecision(history, { keys, now: NOW, ...(reference === undefined ? {} : { reference }) });

    it('allows a flow with no history', () => {
        expect(decide(EMPTY_RERUN_HISTORY, [F])).toMatchObject({ allowed: true });
    });

    it('allows the one rerun after one failure (mutant: limit 1)', () => {
        expect(decide(historyOf({ [F]: 1 }), [F])).toMatchObject({ allowed: true });
    });

    it('refuses after two failures and names the flow (mutant: > 2 for >= 2)', () => {
        expect(decide(historyOf({ [F]: 2 }), [F])).toEqual({ allowed: false, refused: [F] });
    });

    it('allows two failures with a reference and keeps it (mutant: the reference ignored)', () => {
        const decision = decide(historyOf({ [F]: 2 }), [F], 'REPORT-0042');

        expect(decision).toMatchObject({ allowed: true });
        expect(decision.allowed && decision.history.entries[F]).toMatchObject({
            failures: 2,
            references: ['REPORT-0042'],
        });
    });

    it('a reference buys one run, not a reset (mutant: the reference resets the count)', () => {
        const allowed = decide(historyOf({ [F]: 2 }), [F], 'REPORT-0042');

        if (!allowed.allowed) {
            throw new Error('the case needs the first run to be allowed');
        }

        const afterTheRun = recordOutcomes(allowed.history, [fail(F)], NOW);

        expect(failuresOf(afterTheRun, F)).toBe(3);
        expect(decide(afterTheRun, [F])).toEqual({ allowed: false, refused: [F] });
        // The same reference does not buy a second run either.
        expect(decide(afterTheRun, [F], 'REPORT-0042')).toEqual({ allowed: false, refused: [F] });
        expect(decide(afterTheRun, [F], 'REPORT-0043')).toMatchObject({ allowed: true });
    });

    it('a new head is a new key (mutant: head left out of the key)', () => {
        const elsewhere = rerunKey({ ...KEY, head: 'bbbbbbb' });

        expect(decide(historyOf({ [F]: 2 }), [elsewhere])).toMatchObject({ allowed: true });
    });

    it('a fixed flow file is a new key (mutant: blob left out of the key)', () => {
        const fixed = rerunKey({ ...KEY, blob: 'blobY' });

        expect(decide(historyOf({ [F]: 2 }), [fixed])).toMatchObject({ allowed: true });
    });

    it('another device and the other platform are other keys (mutant: device or platform left out)', () => {
        const ipad = rerunKey({ ...KEY, device: 'ipad' });
        const android = rerunKey({ ...KEY, platform: 'android', device: undefined });

        expect(decide(historyOf({ [F]: 2 }), [ipad])).toMatchObject({ allowed: true });
        expect(decide(historyOf({ [F]: 2 }), [android])).toMatchObject({ allowed: true });
    });

    it('one flow at its limit refuses the whole run, naming only that flow', () => {
        expect(decide(historyOf({ [F]: 2 }), [F, G])).toEqual({ allowed: false, refused: [F] });
    });

    it('another flow is allowed, because the count is the flow’s own', () => {
        expect(decide(historyOf({ [F]: 2 }), [G])).toMatchObject({ allowed: true });
    });

    it('an entry older than the history window no longer refuses (mutant: no age check)', () => {
        const stale = historyOf({ [F]: 2 }, daysBefore(RERUN_HISTORY_DAYS + 1));

        expect(decide(stale, [F])).toMatchObject({ allowed: true });
        expect(decide(historyOf({ [F]: 2 }, daysBefore(RERUN_HISTORY_DAYS - 1)), [F])).toEqual({
            allowed: false,
            refused: [F],
        });
    });

    it.each(['', '   ', '\n\t'])('a blank reference (%j) is no reference (mutant: blank accepted)', (blank) => {
        expect(decide(historyOf({ [F]: 2 }), [F], blank)).toEqual({ allowed: false, refused: [F] });
    });

    it('trims a reference before it keeps it', () => {
        const decision = decide(historyOf({ [F]: 2 }), [F], '  REPORT-0042 ');

        expect(decision.allowed && decision.history.entries[F]?.references).toEqual(['REPORT-0042']);
    });

    it('keeps a reference only on the keys it released, not on a key under its limit', () => {
        const decision = decide(historyOf({ [F]: 2, [G]: 1 }), [F, G], 'REPORT-0042');

        expect(decision.allowed && decision.history.entries[G]?.references).toEqual([]);
    });
});

describe('recordOutcomes', () => {
    it('a lane lost before a result counts one failure for each planned flow (mutant: it counts nothing)', () => {
        const next = recordOutcomes(EMPTY_RERUN_HISTORY, [fail(F), fail(G)], NOW);

        expect([failuresOf(next, F), failuresOf(next, G)]).toEqual([1, 1]);
    });

    it('no outcome leaves the history as it was (mutant: a pre-lock failure counts)', () => {
        const before = historyOf({ [F]: 1 });

        expect(recordOutcomes(before, [], NOW)).toEqual(before);
    });

    it('a pass clears the key’s failures (mutant: a pass that does not clear)', () => {
        const next = recordOutcomes(recordOutcomes(EMPTY_RERUN_HISTORY, [fail(F)], NOW), [pass(F)], NOW);

        expect(failuresOf(next, F)).toBe(0);
        expect(rerunDecision(next, { keys: [F], now: NOW })).toMatchObject({ allowed: true });
    });

    it('a pass clears the references too, so the next two failures start clean', () => {
        const released = rerunDecision(historyOf({ [F]: 2 }), { keys: [F], reference: 'P-1', now: NOW });

        if (!released.allowed) {
            throw new Error('the case needs the run to be allowed');
        }

        expect(recordOutcomes(released.history, [pass(F)], NOW).entries[F]).toBeUndefined();
    });

    it('adds to the failures already there and moves the time (mutant: set to 1)', () => {
        const earlier = daysBefore(2);
        const next = recordOutcomes(historyOf({ [F]: 1 }, earlier), [fail(F)], NOW);

        expect(next.entries[F]).toMatchObject({ failures: 2, lastAt: NOW });
    });

    it('a pass for a key with no history changes nothing', () => {
        expect(recordOutcomes(EMPTY_RERUN_HISTORY, [pass(F)], NOW)).toEqual(EMPTY_RERUN_HISTORY);
    });

    it('drops entries older than the window on write (mutant: the prune removed)', () => {
        const old = historyOf({ [F]: 2 }, daysBefore(RERUN_HISTORY_DAYS + 1));
        const next = recordOutcomes(old, [fail(G)], NOW);

        expect(next.entries[F]).toBeUndefined();
        expect(failuresOf(next, G)).toBe(1);
    });

    it('does not change the history it was given', () => {
        const before = historyOf({ [F]: 1 });
        const snapshot = structuredClone(before);

        recordOutcomes(before, [fail(F), pass(G)], NOW);

        expect(before).toEqual(snapshot);
    });
});
