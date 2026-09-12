/**
 * A `food` row as `FoodDao.getById` returns it, for a suite whose food store is a double: a live, public, `PENDING`
 * catalog food waiting on its first fan-out.
 */
import type { FoodRow } from '../../src/db/schema/index.js';

/** When every fixture row was written. */
const WRITTEN_AT = new Date('2026-10-02T12:00:00.000Z');

/**
 * Build a `food` row.
 *
 * @param overrides - Fields to replace.
 * @returns The row.
 */
export function makeFoodRow(overrides: Partial<FoodRow> = {}): FoodRow {
    return {
        id: '01JQZK8N7QF3B2X4M6T0V5C1FD',
        name: null,
        normalizedName: 'broccoli',
        description: null,
        kind: 'generic',
        brandOwner: null,
        brandName: null,
        barcode: null,
        aliases: null,
        status: 'PENDING',
        itemId: '01JQZK8N7QF3B2X4M6T0V5C1IT',
        itemOwnerKind: 'root',
        seedKey: null,
        retiredAt: null,
        userId: null,
        visibility: 'public',
        tombstonedAt: null,
        withdrawnAt: null,
        createdAt: WRITTEN_AT,
        updatedAt: WRITTEN_AT,
        searchVector: null,
        aliasesSearchVector: null,
        rankFolded: null,
        rankTokens: null,
        rankHead: null,
        ...overrides,
    };
}
