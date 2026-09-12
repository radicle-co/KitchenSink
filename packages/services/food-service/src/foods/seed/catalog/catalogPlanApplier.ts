/**
 * Writes a catalog plan, set-based, in the one order 0018's keys and triggers admit (curated catalog plan U6, KTD-1,
 * KTD-8, KTD-12, KTD-19).
 *
 * @pattern Unit of Work — it owns the write order and decides nothing: `catalogPlanBuilder.ts` decided what changes, and
 *   `catalogWriteSet.ts` resolved every row and minted every id
 *
 * Every write is set-based (KTD-1). A table's rows are COPYed into a temp staging table that the transaction drops at
 * its end, then written by one `INSERT … SELECT`; a list of ids is one statement over an array. The phases, and why each
 * comes where it does (no foreign key in 0018 is deferrable, and an item flips its owner kind only while nothing owns
 * it):
 *
 * 1. Dictionary entries the rows name, `ON CONFLICT DO NOTHING` (KTD-14).
 * 2. KTD-12's claims: retire each claimed live food, which frees its name and lets the guard admit the release; then
 *    release each wanted source row and the provenance, category and portion rows citing it.
 * 3. Delete the forwards the plan restores or re-aims; their source ids come back in phase 5 or 8.
 * 4. Delete the variants that leave or move, then the roots that leave: an item outlives its owner.
 * 5. Items, roots and variants: insert new items; flip the kind of the items no row owns now; retire; give each renamed
 *    root a temporary name, then its final row (a swap of two names would otherwise collide); flip the items a root just
 *    moved off; insert roots (a restored id comes from its forward), restore and insert variants.
 * 6. Delete the items the plan leaves with no owner.
 * 7. Replace children whole: delete an item's portions, provenance and categories, then its source rows,
 *    then the owners' headers (citations, values and cited portions cascade) and parts; insert in reverse order.
 * 8. Insert forwards, each to a live root or variant.
 *
 * ⛔ Every statement names its relations by schema (`public.` and `pg_temp.`): the seeder holds TEMPORARY, so an
 * unqualified name could resolve to a temp table of the same name (0018's header). Every `INSERT … SELECT` that joins a
 * dictionary, an owner or a citation, and every statement over a list of ids, must touch exactly the rows it was given,
 * or the apply throws: a dropped join is otherwise silent. Only a delete that replaces a set whole is not counted.
 * Each statement opens with a `catalogSeed:<step>` marker, so a log or a test names the step that failed.
 *
 * ⚠️ Residual: two kept roots that swap items in one plan fail on `food_item_id_unique`, loudly, and roll back. The
 * curated seed has no such pair, and supporting one needs a temporary item the seeder could own.
 */
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { newFoodId } from '../../../db/ulid.js';
import { CatalogApplyError } from './catalogPlanApplier.errors.js';
import { isEmptyPlan, type CatalogPlan } from './catalogPlanBuilder.js';
import type { SnapshotIds } from './catalogSnapshot.js';
import type { CatalogSeedSession } from './catalogSeedSession.js';
import {
    SEEDED_ROOT_COLUMNS,
    SEEDED_SOURCE_COLUMNS,
    SEEDED_VALUE_BASIS,
    resolveCatalogWriteSet,
    type CatalogWriteSet,
} from './catalogWriteSet.js';
import { copyTextLine, type CopyValue } from './pgCopyText.js';

/** How many rows each write step touched, by step. */
export type CatalogApplyCounts = Readonly<Record<string, number>>;

/** One staging table: its columns with their types, and how a row spells them. */
interface StagedTable<Row> {
    /** The temp table is `pg_temp.catalog_seed_<name>`. */
    readonly name: string;
    readonly columns: readonly (readonly [column: string, type: string])[];
    readonly fields: (row: Row) => readonly CopyValue[];
}

/** How many staged rows go to the server in one chunk. */
const COPY_CHUNK_ROWS = 1_000;

/**
 * A staging table's definition. Pure.
 *
 * @param name - Its suffix.
 * @param columns - Its columns.
 * @param fields - Each row's values, in column order.
 * @returns The definition.
 */
function stagedTable<Row>(
    name: string,
    columns: readonly (readonly [string, string])[],
    fields: (row: Row) => readonly CopyValue[],
): StagedTable<Row> {
    return { name, columns, fields };
}

type Rows = CatalogWriteSet;
type Children = CatalogWriteSet['children'];

/** Every staging table the apply writes through. */
const STAGED = {
    nutrient: stagedTable<Rows['dictionary']['nutrients'][number]>(
        'nutrient',
        [
            ['id', 'text'],
            ['name', 'text'],
            ['unit', 'text'],
            ['infoods_tag', 'text'],
        ],
        (row) => [row.id, row.name, row.unit, row.infoodsTag],
    ),
    category: stagedTable<Rows['dictionary']['categories'][number]>(
        'category',
        [
            ['id', 'text'],
            ['name', 'text'],
        ],
        (row) => [row.id, row.name],
    ),
    item: stagedTable<Rows['itemInserts'][number]>(
        'item',
        [
            ['id', 'text'],
            ['natural_key', 'text'],
            ['owner_kind', 'text'],
        ],
        (row) => [row.id, row.naturalKey, row.ownerKind],
    ),
    rootUpdate: stagedTable<Rows['rootUpdates'][number]>(
        'root_update',
        [
            ['id', 'text'],
            ['seed_key', 'text'],
            ['item_id', 'text'],
            ['name', 'text'],
            ['normalized_name', 'text'],
            ['aliases', 'text'],
            ['restore', 'boolean'],
        ],
        (row) => [row.id, row.seedKey, row.itemId, row.name, row.normalizedName, row.aliases, row.restore],
    ),
    root: stagedTable<Rows['rootInserts'][number]>(
        'root',
        [
            ['id', 'text'],
            ['seed_key', 'text'],
            ['item_id', 'text'],
            ['name', 'text'],
            ['normalized_name', 'text'],
            ['aliases', 'text'],
        ],
        (row) => [row.id, row.seedKey, row.itemId, row.name, row.normalizedName, row.aliases],
    ),
    variant: stagedTable<Rows['variantInserts'][number]>(
        'variant',
        [
            ['id', 'text'],
            ['food_id', 'text'],
            ['item_id', 'text'],
        ],
        (row) => [row.id, row.foodId, row.itemId],
    ),
    source: stagedTable<Children['sources'][number]>(
        'source',
        [
            ['id', 'text'],
            ['item_id', 'text'],
            ['source', 'text'],
            ['external_key', 'text'],
            ['lineage_key', 'text'],
        ],
        (row) => [row.id, row.itemId, row.source, row.externalKey, row.lineageKey],
    ),
    header: stagedTable<Children['headers'][number]>(
        'header',
        [
            ['id', 'text'],
            ['food_id', 'text'],
            ['food_variant_id', 'text'],
        ],
        (row) => [row.id, row.foodId, row.variantId],
    ),
    citation: stagedTable<Children['citations'][number]>(
        'citation',
        [
            ['id', 'text'],
            ['nutrition_id', 'text'],
            ['dataset', 'text'],
            ['external_key', 'text'],
            ['match', 'text'],
            ['density_g_per_ml', 'numeric'],
            ['kcal_from_kj', 'boolean'],
            ['url', 'text'],
            ['retrieved_on', 'date'],
            ['manufacturer', 'text'],
            ['serving_label', 'text'],
            ['serving_grams', 'numeric'],
        ],
        (row) => [
            row.id,
            row.nutritionId,
            row.dataset,
            row.externalKey,
            row.match,
            row.densityGPerMl,
            row.kcalFromKj,
            row.url,
            row.retrievedOn,
            row.manufacturer,
            row.servingLabel,
            row.servingGrams,
        ],
    ),
    value: stagedTable<Children['values'][number]>(
        'value',
        [
            ['nutrition_id', 'text'],
            ['citation_id', 'text'],
            ['name', 'text'],
            ['unit', 'text'],
            ['amount', 'numeric'],
            ['trace', 'boolean'],
        ],
        (row) => [row.nutritionId, row.citationId, row.name, row.unit, row.amount, row.trace],
    ),
    sourcePortion: stagedTable<Children['sourcePortions'][number]>(
        'source_portion',
        [
            ['id', 'text'],
            ['item_id', 'text'],
            ['label', 'text'],
            ['gram_weight', 'numeric'],
            ['source_id', 'text'],
        ],
        (row) => [row.id, row.itemId, row.label, row.gramWeight, row.sourceId],
    ),
    citedPortion: stagedTable<Children['citedPortions'][number]>(
        'cited_portion',
        [
            ['id', 'text'],
            ['item_id', 'text'],
            ['label', 'text'],
            ['gram_weight', 'numeric'],
            ['dataset', 'text'],
            ['external_key', 'text'],
            ['url', 'text'],
        ],
        (row) => [row.id, row.itemId, row.label, row.gramWeight, row.dataset, row.externalKey, row.url],
    ),
    categoryAssignment: stagedTable<Children['categories'][number]>(
        'category_assignment',
        [
            ['item_id', 'text'],
            ['name', 'text'],
            ['source_id', 'text'],
        ],
        (row) => [row.itemId, row.name, row.sourceId],
    ),
    part: stagedTable<Children['parts'][number]>(
        'part',
        [
            ['variant_id', 'text'],
            ['attribute', 'text'],
            ['ordinal', 'smallint'],
            ['text', 'text'],
        ],
        (row) => [row.variantId, row.attribute, row.ordinal, row.text],
    ),
    forward: stagedTable<Rows['forwardInserts'][number]>(
        'forward',
        [
            ['source_id', 'text'],
            ['source_kind', 'text'],
            ['source_key', 'text'],
            ['target_food_id', 'text'],
            ['target_variant_id', 'text'],
        ],
        (row) => [row.sourceId, row.sourceKind, row.sourceKey, row.targetFoodId, row.targetVariantId],
    ),
} as const;

/** A staging table's qualified name. Pure. */
const stagingTable = (table: { readonly name: string }): string => `pg_temp.catalog_seed_${table.name}`;

/** The relation `owner_kind` is flipped through, run before and after the roots move (phase 5). */
const FLIP_OWNER_KIND = `UPDATE public.food_item i SET owner_kind = r.owner_kind::public.food_item_owner_kind
      FROM unnest($1::text[], $2::text[]) AS r(id, owner_kind)
     WHERE i.id = r.id AND i.owner_kind::text <> r.owner_kind
       AND NOT EXISTS (SELECT 1 FROM public.food f WHERE f.item_id = i.id)
       AND NOT EXISTS (SELECT 1 FROM public.food_variant v WHERE v.item_id = i.id)`;

/** The rows of a release joined to the source row the holder's item holds (KTD-12's key claim). */
const RELEASED = `public.food_sources s, public.food f, unnest($1::text[], $2::text[], $3::text[]) AS r(holder, source, external_key)
     WHERE f.id = r.holder AND s.item_id = f.item_id AND s.source::text = r.source AND s.external_key = r.external_key`;

/**
 * Staged rows as COPY text, in chunks. Pure.
 *
 * @param table - The staging table.
 * @param rows - Its rows.
 * @yields Chunks of whole lines.
 */
function* copyChunks<Row>(table: StagedTable<Row>, rows: readonly Row[]): Generator<string> {
    for (let start = 0; start < rows.length; start += COPY_CHUNK_ROWS) {
        yield rows
            .slice(start, start + COPY_CHUNK_ROWS)
            .map((row) => copyTextLine(table.fields(row)))
            .join('');
    }
}

/** The statements of one apply, and the counts they report. */
class ApplyRun {
    public readonly counts: Record<string, number> = {};

    public constructor(private readonly connection: CatalogSeedSession) {}

    /**
     * Run one marked statement, and check its row count when one is owed.
     *
     * @param step - The step's name: the marker, and the key of its count.
     * @param sql - The statement.
     * @param values - Its values.
     * @param expected - The rows it must touch, when it is counted.
     * @returns The rows it touched.
     * @throws {CatalogApplyError} `rowCountMismatch` when it touched a different number.
     * @sideEffect Executes the statement.
     */
    public async run(step: string, sql: string, values?: unknown[], expected?: number): Promise<number> {
        const result = await this.connection.query(`/* catalogSeed:${step} */ ${sql}`, values);
        const touched = result.rowCount ?? 0;

        this.counts[step] = touched;

        if (expected !== undefined && touched !== expected) {
            throw new CatalogApplyError(
                'rowCountMismatch',
                step,
                `it was given ${String(expected)} row(s) and touched ${String(touched)}`,
            );
        }

        return touched;
    }

    /**
     * Run a counted statement over a list of ids, when the list is not empty.
     *
     * @param step - The step.
     * @param sql - The statement; `$1` is the list.
     * @param ids - The ids.
     * @sideEffect Executes the statement.
     */
    public async overIds(step: string, sql: string, ids: readonly string[]): Promise<void> {
        if (ids.length > 0) {
            await this.run(step, sql, [ids], ids.length);
        }
    }

    /**
     * Run an uncounted delete that replaces a set whole, when its list is not empty.
     *
     * @param step - The step.
     * @param sql - The statement; `$1` is the list.
     * @param ids - The ids.
     * @sideEffect Executes the statement.
     */
    public async replaceOver(step: string, sql: string, ids: readonly string[]): Promise<void> {
        if (ids.length > 0) {
            await this.run(step, sql, [ids]);
        }
    }

    /**
     * Stage rows in their temp table, then write them with one statement that must touch every one.
     *
     * @param table - The staging table.
     * @param rows - The rows.
     * @param step - The write's step.
     * @param sql - The write, reading the staging table.
     * @param values - The write's values.
     * @param counted - Whether the write must touch every staged row; a dictionary insert skips what exists.
     * @sideEffect Creates and fills a temp table, and executes the write.
     */
    public async stageThen<Row>(
        table: StagedTable<Row>,
        rows: readonly Row[],
        step: string,
        sql: string,
        values: unknown[] = [],
        counted = true,
    ): Promise<void> {
        if (rows.length === 0) {
            return;
        }

        await this.stage(table, rows);
        await this.run(step, sql, values.length === 0 ? undefined : values, counted ? rows.length : undefined);
    }

    /**
     * Create a staging table that the transaction drops at its end, and COPY the rows into it.
     *
     * @param table - The staging table.
     * @param rows - The rows.
     * @sideEffect Creates a temp table and COPYs into it.
     */
    private async stage<Row>(table: StagedTable<Row>, rows: readonly Row[]): Promise<void> {
        const name = stagingTable(table);
        const definitions = table.columns.map(([column, type]) => `${column} ${type}`).join(', ');
        const columns = table.columns.map(([column]) => column).join(', ');

        await this.connection.query(
            `/* catalogSeed:stage:${table.name} */ CREATE TEMP TABLE ${name} (${definitions}) ON COMMIT DROP`,
        );
        await pipeline(
            Readable.from(copyChunks(table, rows)),
            this.connection.copyFrom(`/* catalogSeed:copy:${table.name} */ COPY ${name} (${columns}) FROM STDIN`),
        );
    }
}

/**
 * Phase 1: the dictionary entries the rows name (KTD-14).
 *
 * @param run - The run.
 * @param set - The write set.
 * @sideEffect Inserts into `nutrient` and `food_category`.
 */
async function writeDictionary(run: ApplyRun, set: CatalogWriteSet): Promise<void> {
    await run.stageThen(
        STAGED.nutrient,
        set.dictionary.nutrients,
        'nutrientInsert',
        `INSERT INTO public.nutrient (id, name, unit, infoods_tag)
         SELECT id, name, unit, infoods_tag FROM ${stagingTable(STAGED.nutrient)} ON CONFLICT DO NOTHING`,
        [],
        false,
    );
    await run.stageThen(
        STAGED.category,
        set.dictionary.categories,
        'categoryInsert',
        `INSERT INTO public.food_category (id, name)
         SELECT id, name FROM ${stagingTable(STAGED.category)} ON CONFLICT DO NOTHING`,
        [],
        false,
    );
}

/**
 * Phase 2: KTD-12's claims. Each claimed food is retired first, which frees its name and is the shape the guard admits
 * a release from; then each wanted source row is released with the rows citing it.
 *
 * @param run - The run.
 * @param set - The write set.
 * @sideEffect Updates `food`; deletes from `food_field_provenance`, `food_category_assignment`, `food_portions` and
 *   `food_sources`.
 */
async function releaseClaims(run: ApplyRun, set: CatalogWriteSet): Promise<void> {
    await run.overIds(
        'claimRetire',
        `UPDATE public.food SET retired_at = now(), updated_at = now()
          WHERE id = ANY($1::text[]) AND retired_at IS NULL AND user_id IS NULL AND seed_key IS NULL`,
        set.claims,
    );

    if (set.releases.length === 0) {
        return;
    }

    const lists = [
        set.releases.map((row) => row.holderId),
        set.releases.map((row) => row.source),
        set.releases.map((row) => row.externalKey),
    ];

    await run.run(
        'releaseProvenanceDelete',
        `DELETE FROM public.food_field_provenance p USING ${RELEASED} AND p.item_id = s.item_id AND p.source_id = s.id`,
        lists,
    );
    await run.run(
        'releaseCategoryDelete',
        `DELETE FROM public.food_category_assignment c USING ${RELEASED} AND c.item_id = s.item_id AND c.source_id = s.id`,
        lists,
    );
    await run.run(
        'releasePortionDelete',
        `DELETE FROM public.food_portions p USING ${RELEASED} AND p.item_id = s.item_id AND p.source_id = s.id`,
        lists,
    );
    await run.run(
        'releaseSourceDelete',
        `DELETE FROM public.food_sources s0 USING ${RELEASED} AND s0.id = s.id`,
        lists,
        set.releases.length,
    );
}

/**
 * Phases 3 and 4: the forwards the plan re-inserts, then the variants and roots that leave or move.
 *
 * @param run - The run.
 * @param set - The write set.
 * @sideEffect Deletes from `food_forward`, `food_variant` and `food`.
 */
async function removeDeparting(run: ApplyRun, set: CatalogWriteSet): Promise<void> {
    await run.overIds(
        'forwardDelete',
        'DELETE FROM public.food_forward WHERE source_id = ANY($1::text[])',
        set.forwardDeletes,
    );
    await run.overIds(
        'variantDelete',
        'DELETE FROM public.food_variant WHERE id = ANY($1::text[])',
        set.variantDeletes,
    );
    await run.overIds(
        'rootDelete',
        'DELETE FROM public.food WHERE id = ANY($1::text[]) AND seed_key IS NOT NULL',
        set.rootDeletes,
    );
}

/**
 * Phase 5: items, roots and variants.
 *
 * @param run - The run.
 * @param set - The write set.
 * @throws {CatalogApplyError} `rowCountMismatch` when the two passes did not flip every reowned item exactly once.
 * @sideEffect Writes `food_item`, `food` and `food_variant`.
 */
async function writeOwners(run: ApplyRun, set: CatalogWriteSet): Promise<void> {
    await run.stageThen(
        STAGED.item,
        set.itemInserts,
        'itemInsert',
        `INSERT INTO public.food_item (id, natural_key, owner_kind)
         SELECT id, natural_key, owner_kind::public.food_item_owner_kind FROM ${stagingTable(STAGED.item)}`,
    );

    const flips = [set.itemReowns.map((row) => row.id), set.itemReowns.map((row) => row.ownerKind)];
    const flippedBefore = set.itemReowns.length === 0 ? 0 : await run.run('itemReownBefore', FLIP_OWNER_KIND, flips);

    await run.overIds(
        'rootRetire',
        `UPDATE public.food SET retired_at = now(), updated_at = now()
          WHERE id = ANY($1::text[]) AND seed_key IS NOT NULL AND retired_at IS NULL`,
        set.rootRetires,
    );
    await run.overIds(
        'variantRetire',
        'UPDATE public.food_variant SET retired_at = now() WHERE id = ANY($1::text[]) AND retired_at IS NULL',
        set.variantRetires,
    );

    if (set.rootUpdates.length > 0) {
        const staged = stagingTable(STAGED.rootUpdate);

        await run.stageThen(
            STAGED.rootUpdate,
            set.rootUpdates,
            'rootTempName',
            `UPDATE public.food f SET normalized_name = 'seed:' || f.id FROM ${staged} s
              WHERE f.id = s.id AND f.retired_at IS NULL AND f.normalized_name <> s.normalized_name`,
            [],
            false,
        );
        await run.run(
            'rootUpdate',
            `UPDATE public.food f
                SET name = s.name, normalized_name = s.normalized_name, aliases = s.aliases, item_id = s.item_id,
                    retired_at = CASE WHEN s.restore THEN NULL ELSE f.retired_at END, updated_at = now()
               FROM ${staged} s
              WHERE f.id = s.id AND f.seed_key = s.seed_key`,
            undefined,
            set.rootUpdates.length,
        );
    }

    if (set.itemReowns.length > 0) {
        const flippedAfter = await run.run('itemReownAfter', FLIP_OWNER_KIND, flips);

        if (flippedBefore + flippedAfter !== set.itemReowns.length) {
            throw new CatalogApplyError(
                'rowCountMismatch',
                'itemReownAfter',
                `${String(set.itemReowns.length)} item(s) change owner kind and ${String(flippedBefore + flippedAfter)} flipped`,
            );
        }
    }

    await run.stageThen(
        STAGED.root,
        set.rootInserts,
        'rootInsert',
        `INSERT INTO public.food (id, seed_key, item_id, name, normalized_name, aliases, status, kind, visibility)
         SELECT id, seed_key, item_id, name, normalized_name, aliases,
                $1::public.food_status, $2::public.food_kind, $3::text
           FROM ${stagingTable(STAGED.root)}`,
        [SEEDED_ROOT_COLUMNS.status, SEEDED_ROOT_COLUMNS.kind, SEEDED_ROOT_COLUMNS.visibility],
    );
    await run.overIds(
        'variantRestore',
        'UPDATE public.food_variant SET retired_at = NULL WHERE id = ANY($1::text[]) AND retired_at IS NOT NULL',
        set.variantRestores,
    );
    await run.stageThen(
        STAGED.variant,
        set.variantInserts,
        'variantInsert',
        `INSERT INTO public.food_variant (id, food_id, item_id)
         SELECT id, food_id, item_id FROM ${stagingTable(STAGED.variant)}`,
    );
}

/**
 * Phase 7: replace children whole. Deletes run child-first, so no source row is deleted while a row cites it; inserts
 * run parent-first, so every reference already exists.
 *
 * @param run - The run.
 * @param children - The children.
 * @sideEffect Deletes and inserts every per-item, nutrition and part table.
 */
async function replaceChildren(run: ApplyRun, children: Children): Promise<void> {
    const { itemIds, nutritionOwners } = children;

    await run.replaceOver(
        'childPortionDelete',
        'DELETE FROM public.food_portions WHERE item_id = ANY($1::text[])',
        itemIds,
    );
    await run.replaceOver(
        'childProvenanceDelete',
        'DELETE FROM public.food_field_provenance WHERE item_id = ANY($1::text[])',
        itemIds,
    );
    await run.replaceOver(
        'childCategoryDelete',
        'DELETE FROM public.food_category_assignment WHERE item_id = ANY($1::text[])',
        itemIds,
    );
    await run.replaceOver(
        'childSourceDelete',
        'DELETE FROM public.food_sources WHERE item_id = ANY($1::text[])',
        itemIds,
    );

    if (nutritionOwners.rootIds.length + nutritionOwners.variantIds.length > 0) {
        await run.run(
            'nutritionDelete',
            'DELETE FROM public.food_nutrition WHERE food_id = ANY($1::text[]) OR food_variant_id = ANY($2::text[])',
            [nutritionOwners.rootIds, nutritionOwners.variantIds],
        );
    }

    await run.replaceOver(
        'partDelete',
        'DELETE FROM public.food_variant_part WHERE variant_id = ANY($1::text[])',
        children.partsVariantIds,
    );

    await run.stageThen(
        STAGED.source,
        children.sources,
        'sourceInsert',
        `INSERT INTO public.food_sources (id, item_id, source, external_key, lineage_key, fetch_state, item_version)
         SELECT id, item_id, source::public.food_source, external_key, lineage_key, $1::text, $2::text
           FROM ${stagingTable(STAGED.source)}`,
        [SEEDED_SOURCE_COLUMNS.fetchState, SEEDED_SOURCE_COLUMNS.itemVersion],
    );
    await run.stageThen(
        STAGED.header,
        children.headers,
        'headerInsert',
        `INSERT INTO public.food_nutrition (id, food_id, food_variant_id)
         SELECT id, food_id, food_variant_id FROM ${stagingTable(STAGED.header)}`,
    );
    await run.stageThen(
        STAGED.citation,
        children.citations,
        'citationInsert',
        `INSERT INTO public.food_nutrition_citation (id, nutrition_id, dataset, external_key, match, density_g_per_ml,
                kcal_from_kj, url, retrieved_on, manufacturer, serving_label, serving_grams)
         SELECT id, nutrition_id, dataset::public.citation_dataset, external_key, match::public.citation_match,
                density_g_per_ml, kcal_from_kj, url, retrieved_on, manufacturer, serving_label, serving_grams
           FROM ${stagingTable(STAGED.citation)}`,
    );
    await run.stageThen(
        STAGED.value,
        children.values,
        'valueInsert',
        `INSERT INTO public.food_nutrition_value (nutrition_id, nutrient_id, amount, trace, basis, citation_id)
         SELECT s.nutrition_id, n.id, s.amount, s.trace, $1::public.nutrient_basis, s.citation_id
           FROM ${stagingTable(STAGED.value)} s JOIN public.nutrient n ON n.name = s.name AND n.unit = s.unit`,
        [SEEDED_VALUE_BASIS],
    );
    await run.stageThen(
        STAGED.sourcePortion,
        children.sourcePortions,
        'sourcePortionInsert',
        `INSERT INTO public.food_portions (id, item_id, label, gram_weight, source_id)
         SELECT id, item_id, label, gram_weight, source_id FROM ${stagingTable(STAGED.sourcePortion)}`,
    );
    // A cited portion cites its OWN owner's one citation, found through the item's root or variant, and matched on what
    // it says it cites, so a portion can never land on another owner's citation.
    await run.stageThen(
        STAGED.citedPortion,
        children.citedPortions,
        'citedPortionInsert',
        `INSERT INTO public.food_portions (id, item_id, label, gram_weight, citation_id)
         SELECT s.id, s.item_id, s.label, s.gram_weight, c.id
           FROM ${stagingTable(STAGED.citedPortion)} s
           LEFT JOIN public.food f ON f.item_id = s.item_id
           LEFT JOIN public.food_variant v ON v.item_id = s.item_id
           JOIN public.food_nutrition h ON h.food_id = f.id OR h.food_variant_id = v.id
           JOIN public.food_nutrition_citation c ON c.nutrition_id = h.id
          WHERE c.dataset::text = s.dataset AND c.external_key IS NOT DISTINCT FROM s.external_key
            AND c.url IS NOT DISTINCT FROM s.url`,
    );
    await run.stageThen(
        STAGED.categoryAssignment,
        children.categories,
        'categoryAssignmentInsert',
        `INSERT INTO public.food_category_assignment (item_id, category_id, source_id)
         SELECT s.item_id, c.id, s.source_id
           FROM ${stagingTable(STAGED.categoryAssignment)} s JOIN public.food_category c ON c.name = s.name`,
    );
    await run.stageThen(
        STAGED.part,
        children.parts,
        'partInsert',
        `INSERT INTO public.food_variant_part (variant_id, attribute, ordinal, text)
         SELECT variant_id, attribute::public.food_variant_attribute, ordinal, text FROM ${stagingTable(STAGED.part)}`,
    );
}

/**
 * Write a plan on the caller's open transaction.
 *
 * The caller owns the transaction, its timeouts and its search path, and rolls it back on any throw: this function
 * leaves a half-written catalog behind it when it throws, by design, because nothing but a rollback may end it.
 *
 * @param session - The connection, inside a READ COMMITTED transaction.
 * @param plan - The plan.
 * @param held - The snapshot's ids the plan was built against.
 * @param mintId - The one source of new ids.
 * @returns How many rows each step touched.
 * @throws {CatalogApplyError} when the plan cannot be resolved, or a statement touches a different number of rows than
 *   it was given.
 * @sideEffect Writes every catalog table and the two dictionaries; creates temp staging tables dropped at commit.
 */
export async function applyCatalogPlan(
    session: CatalogSeedSession,
    plan: CatalogPlan,
    held: SnapshotIds,
    mintId: () => string = newFoodId,
): Promise<CatalogApplyCounts> {
    if (isEmptyPlan(plan)) {
        return {};
    }

    const set = resolveCatalogWriteSet(plan, held, mintId);
    const run = new ApplyRun(session);

    await writeDictionary(run, set);
    await releaseClaims(run, set);
    await removeDeparting(run, set);
    await writeOwners(run, set);
    await run.overIds(
        'itemDelete',
        'DELETE FROM public.food_item WHERE id = ANY($1::text[]) AND natural_key IS NOT NULL',
        set.itemDeletes,
    );
    await replaceChildren(run, set.children);
    await run.stageThen(
        STAGED.forward,
        set.forwardInserts,
        'forwardInsert',
        `INSERT INTO public.food_forward (source_id, source_kind, source_key, target_food_id, target_variant_id)
         SELECT source_id, source_kind::public.food_item_owner_kind, source_key, target_food_id, target_variant_id
           FROM ${stagingTable(STAGED.forward)}`,
    );

    return run.counts;
}
