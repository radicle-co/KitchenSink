/**
 * The ids a bulk import declares a line's name under (review item 4 on #220).
 *
 * A declared name is a new record each time it is asked for, and the save declares its names before the create runs, outside
 * the recipe's transaction. A create that then fails left a record behind on every retry. The ids are derived from where the
 * name sits in the import, so a retry declares the SAME record, and two places never share one.
 */
import { describe, expect, it } from 'vitest';

import { sha256Hex } from '../../../common/sha256.js';
import { importDeclaredNameIdsOf, type DeclaredNameSlot } from '../importDeclaredName.js';

const SLOT: DeclaredNameSlot = {
    importId: '11111111-1111-4111-8111-111111111111',
    ordinal: 3,
    generation: 0,
    lineIndex: 2,
    foodIndex: 1,
};
const idsOf = (patch: Partial<DeclaredNameSlot> = {}) => importDeclaredNameIdsOf({ ...SLOT, ...patch }, sha256Hex);

describe('importDeclaredNameIdsOf', () => {
    it('⛔ answers the same ids for the same slot, so a retry declares the same record', () => {
        expect(idsOf()).toStrictEqual(idsOf());
    });

    it('answers two different ids, one for the failure record and one for its binding', () => {
        const { failureId, lookupId } = idsOf();

        expect(failureId).not.toBe(lookupId);
    });

    it.each([
        ['import', { importId: '22222222-2222-4222-8222-222222222222' }],
        ['ordinal', { ordinal: 4 }],
        ['generation', { generation: 1 }],
        ['line', { lineIndex: 3 }],
        ['food', { foodIndex: 0 }],
        ['a line kept whole', { foodIndex: 'whole' as const }],
    ])('⛔ answers other ids when the %s differs, so two places never share a record', (_part, patch) => {
        const other = idsOf(patch);

        expect(other.failureId).not.toBe(idsOf().failureId);
        expect(other.lookupId).not.toBe(idsOf().lookupId);
    });

    it('answers RFC 9562 version 8 UUIDs, which no random (version 4) id can equal', () => {
        const uuidV8 = /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

        expect(idsOf().failureId).toMatch(uuidV8);
        expect(idsOf().lookupId).toMatch(uuidV8);
    });
});
