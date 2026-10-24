/**
 * Unit tests for `authorshipPolicy` (plan U10, D9a) — written RED-first from the plan's scenarios.
 *
 * The policy is a pure total function over `{ callerId, food{userId, visibility}, action }`, and the
 * scenarios pin its three load-bearing asymmetries:
 *
 *  1. a stranger touching a PRIVATE food gets `not-found` for EVERY action — read included — because a
 *     403 would confirm another user's private record exists;
 *  2. a PROMOTED food is readable by everyone but answers `forbidden` (403) on a stranger's edit/delete —
 *     it is public knowledge now, so existence is not a secret, but authorship still gates writes;
 *  3. a PIPELINE food (no author) answers `not-editable` on edit/delete for EVERYONE — the single-writer
 *     ruling (T150/D8): the merge engine owns catalog rows, and no principal may edit one by hand.
 */
import { describe, expect, it } from 'vitest';

import { evaluateAuthorship } from '../authorshipPolicy.js';

const AUTHOR = '01JAUTHORAAAAAAAAAAAAAAAAA';
const STRANGER = '01JSTRANGERBBBBBBBBBBBBBBB';

const privateFood = { userId: AUTHOR, visibility: 'private' as const };
const promotedFood = { userId: AUTHOR, visibility: 'promoted' as const };
const catalogFood = { userId: null, visibility: 'public' as const };

describe('evaluateAuthorship', () => {
    it('the author may read, edit, and delete their own food — private or promoted', () => {
        for (const food of [privateFood, promotedFood]) {
            for (const action of ['read', 'edit', 'delete'] as const) {
                expect(evaluateAuthorship({ callerId: AUTHOR, food, action })).toEqual({ kind: 'allowed' });
            }
        }
    });

    it('⛔ a stranger touching a PRIVATE food gets not-found on EVERY action — existence concealed', () => {
        for (const action of ['read', 'edit', 'delete'] as const) {
            expect(evaluateAuthorship({ callerId: STRANGER, food: privateFood, action })).toEqual({
                kind: 'not-found',
            });
        }
    });

    it('a PROMOTED food reads for everyone but answers forbidden on a stranger write', () => {
        expect(evaluateAuthorship({ callerId: STRANGER, food: promotedFood, action: 'read' })).toEqual({
            kind: 'allowed',
        });

        for (const action of ['edit', 'delete'] as const) {
            expect(evaluateAuthorship({ callerId: STRANGER, food: promotedFood, action })).toEqual({
                kind: 'forbidden',
            });
        }
    });

    it('⛔ a PIPELINE food is readable by all and editable by NOBODY — the single-writer ruling', () => {
        expect(evaluateAuthorship({ callerId: AUTHOR, food: catalogFood, action: 'read' })).toEqual({
            kind: 'allowed',
        });

        for (const action of ['edit', 'delete'] as const) {
            expect(evaluateAuthorship({ callerId: AUTHOR, food: catalogFood, action })).toEqual({
                kind: 'not-editable',
            });
        }
    });
});
