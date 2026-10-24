/**
 * Which pick brings a row the page should show (`docs/design/uiOverhaul/ingredientArrival.md`, behavior 3): a settled
 * commit on the trailing add row that committed a line, which the cook has not moved past and which was settled while
 * the cook was here. Every other outcome, target and moment brings none.
 */
import { describe, expect, it } from 'vitest';

import type { LineCommitOutcome, LineCommitTarget } from '../../hooks/lineCommit.js';
import { rowArrivalOf } from '../rowArrival.js';
import type { IngredientLineKey } from '../lineKey.js';

const KEY = 'line-9' as IngredientLineKey;

const committed: LineCommitOutcome = {
    kind: 'committed',
    key: KEY,
    binding: { ingredientId: 'ing_a', isUserEntered: false },
};

/** A pick the cook is still at: nothing moved past it, heard, and not typed over. */
const FRESH = { movedPast: false, heard: true, interrupted: false } as const;

const settled = (target: LineCommitTarget, outcome: LineCommitOutcome) => ({ target, outcome });

describe('rowArrivalOf', () => {
    it('is the committed row of a settled pick on the trailing add row', () => {
        expect(rowArrivalOf(settled({ kind: 'newLine' }, committed), FRESH)).toEqual({
            key: KEY,
        });
    });

    it.each([
        ['no commit has settled', undefined],
        ['a pick on an existing row (Change food)', settled({ kind: 'line', key: KEY }, committed)],
        ['the pick failed', settled({ kind: 'newLine' }, { kind: 'failed' })],
        ['the recipe changed under the pick (a conflict)', settled({ kind: 'newLine' }, { kind: 'conflict' })],
        ['a remote food is gone', settled({ kind: 'newLine' }, { kind: 'remoteGone' })],
        ['the source is busy', settled({ kind: 'newLine' }, { kind: 'sourceBusy' })],
        ['the cook’s limit refused the pick', settled({ kind: 'newLine' }, { kind: 'limited', retryAt: 1 })],
    ] as const)('is none when %s', (_case, last) => {
        expect(rowArrivalOf(last, FRESH)).toBeUndefined();
    });

    it('is none once the cook has moved past the pick (typed, picked again, Change food, cancelled)', () => {
        expect(rowArrivalOf(settled({ kind: 'newLine' }, committed), { ...FRESH, movedPast: true })).toBeUndefined();
    });

    it('is none for a commit that settled before the cook was here', () => {
        expect(rowArrivalOf(settled({ kind: 'newLine' }, committed), { ...FRESH, heard: false })).toBeUndefined();
    });

    it('is none when the cook typed in the add field while the pick was in flight', () => {
        expect(rowArrivalOf(settled({ kind: 'newLine' }, committed), { ...FRESH, interrupted: true })).toBeUndefined();
    });
});
