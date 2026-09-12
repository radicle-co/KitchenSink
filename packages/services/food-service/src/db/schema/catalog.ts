/**
 * Food's catalog table registry (curated catalog plan KTD-13, KTD-14, KTD-18, ADR-0051 §6).
 *
 * Four disjoint sets of Drizzle tables, projected to names:
 *
 * - **catalog** — the seeded tables. The ownership trigger guards them (`food_forward` by its own trigger), and the
 *   seeder holds DML on them.
 * - **serviceReadOnly** — the seed ledger: SELECT and INSERT for the seeder, SELECT only for the service.
 * - **dictionaries** — the shared dictionaries (KTD-14): SELECT and INSERT for both, no UPDATE or DELETE.
 * - **nonCatalog** — every other table, each with its reason. The service role keeps its default DML there.
 *
 * The first three are the table policy food's migrate handler passes to `@kitchensink/db-schema-guard`, so that
 * package never names a food table. `catalogSchema.e2e.test.ts` reads the migrated schema and holds every table but
 * the runner's own ledger to exactly one set, so a new table cannot fall into a default nobody chose.
 *
 * @pattern Registry — one authority for which set each catalog-adjacent table is in
 */
import { getTableName } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';

import type { TablePolicy } from '@kitchensink/db-schema-guard';

import {
    foodCategoryAssignment,
    foodFieldProvenance,
    foodForward,
    foodItem,
    foodPopularity,
    foodPortions,
    foodSources,
    foodVariant,
    foodVariantPart,
} from './catalogItems.js';
import { food, foodCategory, foodPromotions, foodVersions, nutrient } from './food.js';
import { foodCandidates } from './foodCandidates.js';
import { foodNutrition, foodNutritionCitation, foodNutritionValue } from './foodNutrition.js';
import { fetchQueue, fetchRequesters, sourceBackoff, sourceCallLog, sourceSyncMetadata } from './operational.js';
import type { CatalogRegistry } from './catalogPartition.js';
import { catalogSeedLedger } from './seedLedger.js';

/** The seeded tables. */
const CATALOG_TABLES: readonly PgTable[] = [
    foodItem,
    food,
    foodVariant,
    foodVariantPart,
    foodSources,
    foodFieldProvenance,
    foodCategoryAssignment,
    foodPopularity,
    foodNutrition,
    foodNutritionCitation,
    foodNutritionValue,
    foodPortions,
    foodForward,
];

/** The tables the seeder appends to and the service only reads. */
const SERVICE_READ_ONLY_TABLES: readonly PgTable[] = [catalogSeedLedger];

/** The shared dictionaries. */
const DICTIONARY_TABLES: readonly PgTable[] = [nutrient, foodCategory];

/** Every other table, and why it is not catalog. The service role keeps its default DML; the seeder holds nothing. */
const NON_CATALOG_TABLES: readonly (readonly [PgTable, string])[] = [
    [fetchQueue, 'live demand for a food: written by the service, never by the seed'],
    [fetchRequesters, 'who asked for a food: personal data the erasure sweep deletes'],
    [foodCandidates, 'the live disambiguation set of an unresolved food'],
    [foodVersions, "an authored food's edit history"],
    [foodPromotions, 'the moderation queue for authored foods, written by the service'],
    [sourceCallLog, 'the live source calls the rate limiter counts'],
    [sourceBackoff, 'the live block a source response earned, which admission reads'],
    [sourceSyncMetadata, 'per-source sync bookkeeping of the live path'],
];

/** Project tables to their names. Pure. */
const names = (tables: readonly PgTable[]): ReadonlySet<string> => new Set(tables.map((table) => getTableName(table)));

/** The registry, by table name. */
export const FOOD_CATALOG_REGISTRY: CatalogRegistry = {
    catalog: names(CATALOG_TABLES),
    serviceReadOnly: names(SERVICE_READ_ONLY_TABLES),
    dictionaries: names(DICTIONARY_TABLES),
    nonCatalog: new Map(NON_CATALOG_TABLES.map(([table, reason]) => [getTableName(table), reason])),
};

/** Food's table policy: the registry's first three sets, for the runner's grants and audits (KTD-13). */
export const FOOD_TABLE_POLICY: TablePolicy = {
    catalog: FOOD_CATALOG_REGISTRY.catalog,
    serviceReadOnly: FOOD_CATALOG_REGISTRY.serviceReadOnly,
    dictionaries: FOOD_CATALOG_REGISTRY.dictionaries,
};
