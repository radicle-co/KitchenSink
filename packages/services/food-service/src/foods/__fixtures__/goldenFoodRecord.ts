/**
 * Fixture factory for the golden-record read shape (`make*` accepting `Partial<T>`, per CODING_STANDARDS).
 */
import type { GoldenFoodRecord } from '../dao/food.dao.js';

/**
 * One assembled golden record. Defaults to a RESOLVED CATALOG food with no values.
 *
 * @param overrides - The fields to change.
 * @returns The record. Pure.
 */
export function makeGoldenFoodRecord(overrides: Partial<GoldenFoodRecord> = {}): GoldenFoodRecord {
    return {
        id: '01J9ZZZZZZZZZZZZZZZZZZZZZZ',
        name: 'Broccoli, raw',
        description: null,
        kind: 'generic',
        brandOwner: null,
        brandName: null,
        barcode: null,
        status: 'RESOLVED',
        tombstonedAt: null,
        createdAt: '2026-09-01T00:00:00.000Z',
        updatedAt: '2026-09-01T00:00:00.000Z',
        sources: [],
        nutrients: [],
        portions: [],
        fieldProvenance: [],
        priorFraction: null,
        userId: null,
        visibility: 'public',
        ...overrides,
    };
}
