/**
 * The service helper every recipe-item producer calls: it maps a stored row and the viewer's selected facts into
 * `hiddenReasonOf`. The wiring is what is tested here (which column feeds which input, and the owner gate on the id);
 * the ranking itself is recipe-core's table.
 */
import { describe, expect, it } from 'vitest';

import { makeRecipeRow } from '../../../__fixtures__/index.js';
import { hiddenReasonOfRow } from '../hiddenReasonOfRow.js';

const OWNER = '01JHIDDENROWOWNER00000001';
const OTHER = '01JHIDDENROWOTHER00000001';

const held = { heldFromReaders: true, hasCookSourceEvidence: false };
const publicRow = (overrides: Parameters<typeof makeRecipeRow>[0] = {}) =>
    makeRecipeRow({ ownerId: OWNER, visibility: 'public', ...overrides });

describe('hiddenReasonOfRow', () => {
    it.each([
        ['the correction hold column', publicRow({ sourceCorrectionHold: true }), held, 'sourceCorrected'],
        [
            'a private-only origin on the row',
            publicRow({ sourceType: 'imported_physical', sourceKind: 'book' }),
            held,
            'heldSource',
        ],
        ['the selected cook-evidence term', publicRow(), { ...held, hasCookSourceEvidence: true }, 'heldSource'],
        [
            'a hold no term here maps (a from-person recipe after a staff clear, AE4 owner view)',
            publicRow({ sourceCorrectionHold: false }),
            held,
            'other',
        ],
    ] as const)('tells the owner %s: %s', (_name, row, facts, expected) => {
        expect(hiddenReasonOfRow(row, { viewerId: OWNER, ...facts })).toBe(expected);
    });

    it('tells nobody else, with the read rule holding the row and every term set (AE3)', () => {
        const row = publicRow({ sourceCorrectionHold: true, sourceType: 'imported_physical', sourceKind: 'book' });
        const facts = { heldFromReaders: true, hasCookSourceEvidence: true };

        expect(hiddenReasonOfRow(row, { viewerId: OTHER, ...facts })).toBeUndefined();
        expect(hiddenReasonOfRow(row, { viewerId: undefined, ...facts })).toBeUndefined();
    });

    it('says nothing for a row the read rule does not hold, or a private one', () => {
        expect(
            hiddenReasonOfRow(publicRow({ sourceCorrectionHold: true }), {
                viewerId: OWNER,
                heldFromReaders: false,
                hasCookSourceEvidence: true,
            }),
        ).toBeUndefined();
        expect(
            hiddenReasonOfRow(publicRow({ visibility: 'private', sourceCorrectionHold: true }), {
                viewerId: OWNER,
                ...held,
            }),
        ).toBeUndefined();
    });
});
