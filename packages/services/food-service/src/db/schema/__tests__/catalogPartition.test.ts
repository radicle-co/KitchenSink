/**
 * The catalog partition predicate (curated catalog plan KTD-13, widened by the db-arch-1 review of U4a): EVERY table
 * of the schema but the runner's own ledger is in exactly one registry set, and every registry entry names a table.
 * A table no set names would otherwise get the service role's default DML and nothing for the seeder, silently.
 */
import { describe, expect, it } from 'vitest';

import { catalogPartitionProblems, type CatalogRegistry } from '../catalogPartition.js';

/** A small schema: the three anchors, a per-item child, a queue, a dictionary, a ledger, a limiter and the runner's. */
const TABLES = [
    'food_item',
    'food',
    'food_variant',
    'per_item',
    'queue',
    'dictionary',
    'ledger',
    'limiter',
    'schema_migrations',
];

const REGISTRY: CatalogRegistry = {
    catalog: new Set(['food_item', 'food', 'food_variant', 'per_item']),
    serviceReadOnly: new Set(['ledger']),
    dictionaries: new Set(['dictionary']),
    nonCatalog: new Map([
        ['queue', 'work, not catalog'],
        ['limiter', 'source calls, not catalog'],
    ]),
};

describe('catalogPartitionProblems', () => {
    it('finds nothing when every table is in exactly one set', () => {
        expect(catalogPartitionProblems({ tables: TABLES, registry: REGISTRY })).toStrictEqual([]);
    });

    it.each(['rogue_child_of_food_item', 'rogue_child_of_food_nutrition', 'unrelated'])(
        'reports an unregistered table %s',
        (table) => {
            expect(catalogPartitionProblems({ tables: [...TABLES, table], registry: REGISTRY })).toStrictEqual([
                { kind: 'unregistered', table },
            ]);
        },
    );

    it('reports an anchor that is itself unregistered', () => {
        const registry = { ...REGISTRY, catalog: new Set(['food', 'food_variant', 'per_item']) };

        expect(catalogPartitionProblems({ tables: TABLES, registry })).toStrictEqual([
            { kind: 'unregistered', table: 'food_item' },
        ]);
    });

    it("leaves the runner's migration ledger to the runner", () => {
        expect(catalogPartitionProblems({ tables: TABLES, registry: REGISTRY })).not.toContainEqual(
            expect.objectContaining({ table: 'schema_migrations' }),
        );
    });

    it('reports a table in two sets, naming the sets in registry order', () => {
        const registry = { ...REGISTRY, nonCatalog: new Map([...REGISTRY.nonCatalog, ['per_item', 'twice']]) };

        expect(catalogPartitionProblems({ tables: TABLES, registry })).toStrictEqual([
            { kind: 'inSeveralSets', table: 'per_item', sets: ['catalog', 'nonCatalog'] },
        ]);
    });

    it('reports a registry entry that names no table, in any set', () => {
        const registry = {
            ...REGISTRY,
            serviceReadOnly: new Set(['ledger', 'ghost_ledger']),
            nonCatalog: new Map([...REGISTRY.nonCatalog, ['ghost_queue', 'gone']]),
        };

        expect(catalogPartitionProblems({ tables: TABLES, registry })).toStrictEqual([
            { kind: 'absent', table: 'ghost_ledger' },
            { kind: 'absent', table: 'ghost_queue' },
        ]);
    });
});
