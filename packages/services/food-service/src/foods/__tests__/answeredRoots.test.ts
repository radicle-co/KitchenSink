/**
 * Unit tests for `AnsweredRoots` (ADR-0040, food half): the one door through which an answer that names catalog roots
 * places a hold on them. Written RED-first.
 *
 * The RULE (who holds) is `testPickedRootPolicy.marksRealHold`; this door only applies it, de-duplicates, and spends no
 * round trip when there is nothing to hold.
 */
import { describe, expect, it } from 'vitest';

import { AnsweredRoots } from '../answeredRoots.js';

function makeHolds(fail = false): { readonly holds: AnsweredRoots; readonly calls: string[][] } {
    const calls: string[][] = [];
    const holds = new AnsweredRoots({
        markHeldByRealUser: async (ids) => {
            if (fail) {
                throw new Error('database down');
            }

            calls.push([...ids]);
        },
    });

    return { holds, calls };
}

describe('AnsweredRoots.hold', () => {
    it('⛔ holds the roots a real cook was answered, once each', async () => {
        const { holds, calls } = makeHolds();

        await holds.hold({ testPrincipal: false }, ['R1', 'R2', 'R1']);

        expect(calls).toStrictEqual([['R1', 'R2']]);
    });

    it('⛔ holds the roots an answer no principal shaped names', async () => {
        const { holds, calls } = makeHolds();

        await holds.hold(undefined, ['R1']);

        expect(calls).toStrictEqual([['R1']]);
    });

    it('holds nothing for a test principal, so its own purge still reaches what it shares', async () => {
        const { holds, calls } = makeHolds();

        await holds.hold({ testPrincipal: true }, ['R1']);

        expect(calls).toStrictEqual([]);
    });

    it('spends no write on an answer that names no root', async () => {
        const { holds, calls } = makeHolds();

        await holds.hold({ testPrincipal: false }, []);

        expect(calls).toStrictEqual([]);
    });

    it('fails when the hold cannot be written: an answer must never leave unprotected', async () => {
        const { holds } = makeHolds(true);

        await expect(holds.hold({ testPrincipal: false }, ['R1'])).rejects.toThrow('database down');
    });
});
