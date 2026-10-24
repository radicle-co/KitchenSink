/**
 * The catalog partition predicate (curated catalog plan KTD-13).
 *
 * Every table of the schema but the runner's own ledger must be in exactly one set of the catalog registry, and every
 * registry entry must name a table that exists. A table a migration adds therefore fails a LOCAL e2e test until
 * someone decides which set it belongs to: a table no set names would otherwise get the service role's default DML
 * and nothing for the seeder, silently (db-arch-1 review of U4a widened this from the tables with a foreign-key path
 * to a catalog anchor to every table).
 *
 * @pattern Specification — one pure predicate over the schema's tables, read by the discovery guard
 */
import { MIGRATION_LEDGER_TABLE } from '@kitchensink/db-schema-guard';

/**
 * The registry's four disjoint sets. The first three are the table policy's; `nonCatalog` names every other table,
 * with the reason it is not catalog.
 */
export interface CatalogRegistry {
    readonly catalog: ReadonlySet<string>;
    readonly serviceReadOnly: ReadonlySet<string>;
    readonly dictionaries: ReadonlySet<string>;
    readonly nonCatalog: ReadonlyMap<string, string>;
}

/** The registry's sets, in the order a problem names them. */
const REGISTRY_SETS = ['catalog', 'serviceReadOnly', 'dictionaries', 'nonCatalog'] as const;

/** What is wrong with one table. */
export type CatalogPartitionProblem =
    | { readonly kind: 'unregistered'; readonly table: string }
    | { readonly kind: 'inSeveralSets'; readonly table: string; readonly sets: readonly string[] }
    | { readonly kind: 'absent'; readonly table: string };

/** The schema's tables and the registry the predicate reads. */
export interface CatalogPartitionInput {
    readonly tables: readonly string[];
    readonly registry: CatalogRegistry;
}

/**
 * Every problem with the partition, unregistered tables first, then tables in several sets, then absent entries, each
 * group sorted by table. Pure.
 *
 * @param input - The tables and the registry.
 * @returns The problems; empty when the partition holds.
 */
export function catalogPartitionProblems(input: CatalogPartitionInput): readonly CatalogPartitionProblem[] {
    const { tables, registry } = input;
    const setsOf = (table: string): string[] =>
        REGISTRY_SETS.filter((set) =>
            set === 'nonCatalog' ? registry.nonCatalog.has(table) : registry[set].has(table),
        );
    const registered = [
        ...new Set(
            REGISTRY_SETS.flatMap((set) =>
                set === 'nonCatalog' ? [...registry.nonCatalog.keys()] : [...registry[set]],
            ),
        ),
    ].sort();
    const existing = new Set(tables);
    const unregistered = [...existing]
        .filter((table) => table !== MIGRATION_LEDGER_TABLE && setsOf(table).length === 0)
        .sort()
        .map((table): CatalogPartitionProblem => ({ kind: 'unregistered', table }));
    const several = registered
        .filter((table) => setsOf(table).length > 1)
        .map((table): CatalogPartitionProblem => ({ kind: 'inSeveralSets', table, sets: setsOf(table) }));
    const absent = registered
        .filter((table) => !existing.has(table))
        .map((table): CatalogPartitionProblem => ({ kind: 'absent', table }));

    return [...unregistered, ...several, ...absent];
}
