/**
 * The bulk import's SAVE against a REAL database (LOCAL e2e, ADR-0072 §5 and §9): the real `ImportAdvanceService` over the
 * real import DALs, with every other collaborator taken from the booted app (the real `RecipesService.create`, ingredients,
 * matcher, line view reads), and only food stood in by its fake. The review on #220 named this gap: every save test below
 * the e2e tier hands the create path to a fake.
 *
 * ⚠️ The service is composed HERE, not read from the container: no module provides it on this branch yet (its route lands
 * with the controller). Each argument is the app's own instance or a real DAL over the same database, so nothing below the
 * service is a double.
 *
 * What a mocked create cannot prove, and each assertion is there to catch:
 *
 *  - the statement becomes the recipe's provenance on the stored row: a web copy is `imported_public` with source kind
 *    `public_web`, a book recipe `imported_physical`, and both keep the private visibility the cook chose;
 *  - the line origins reach `ingredients`: a bound line carries `bound_by` and its `import_line_id`, a line kept as written
 *    its link and no origin (kills: `lineOrigins` dropped on the way to `create`);
 *  - the claim commits in the recipe's own transaction: the item is saved with the id of the recipe that was written;
 *  - an item the cook must unblock (no servings) is HELD at the revision the save read, and no recipe exists for it.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { CallerToken } from '../../../src/auth/CallerToken.js';
import { ImportAllowanceDal } from '../../../src/common/dal/importAllowance.dal.js';
import { createRecipeDrizzle, type RecipeDrizzle } from '../../../src/database/client.js';
import { makePrincipal } from '../../../src/import/__fixtures__/importFixtures.js';
import { RecipeImportItemsDal } from '../../../src/import/dal/recipeImportItems.dal.js';
import { RecipeImportLinesDal, type NewImportLine } from '../../../src/import/dal/recipeImportLines.dal.js';
import { RecipeImportsDal } from '../../../src/import/dal/recipeImports.dal.js';
import { DEFAULT_IMPORT_ADVANCE_LIMITS } from '../../../src/import/domain/importLimits.js';
import { ImportAdvanceService } from '../../../src/import/importAdvance.service.js';
import { ImportLineView } from '../../../src/import/importLineView.js';
import { ImportViewBuilder } from '../../../src/import/importView.builder.js';
import { privateSlotsOf } from '../../../src/import/privateSlots.port.js';
import { FoodLookupsDal } from '../../../src/ingredients/dal/foodLookups.dal.js';
import { FoodRefsGateway } from '../../../src/ingredients/foodRefs.gateway.js';
import { IngredientsService } from '../../../src/ingredients/ingredients.service.js';
import { MatchProposalService, PARSE_JOB_MATCHES_DAL } from '../../../src/recipes/matchProposal.service.js';
import { CURATION_DISAGREEMENT_SINK } from '../../../src/recipes/parseJobMatchView.js';
import { ParseJobsService } from '../../../src/recipes/parseJobs.service.js';
import { RecipesService } from '../../../src/recipes/recipes.service.js';
import { RECIPE_LINE_VERIFICATIONS_DAL } from '../../../src/recipes/recipes.tokens.js';
import { bootRecipeApp, type BootedRecipeApp } from '../harness.js';
import { deleteBindingsMatching } from '../../support/bindingCleanup.js';
import { bearerFor, startFoodFake, type FoodFake } from '../../support/foodFake.js';
import { recipeDb } from '../../support/roleDb.js';

const roleDb = recipeDb();

const SCOPE = 'e2e-import-save';
const COOK = '01JIMPORTSAVEE2E000000COOK';
const FLOUR = `${SCOPE}-flour`;
const WEB = 0;
const BOOK = 1;
const HELD = 2;

let booted: BootedRecipeApp;
let pool: pg.Pool;
let food: FoodFake;

const recipe = (title: string, ingredientLines: readonly string[], servings?: number) => ({
    title: `${SCOPE} ${title}`,
    cuisine: 'American',
    ...(servings === undefined ? {} : { servings }),
    prepTimeMinutes: 5,
    cookTimeMinutes: 10,
    totalTimeMinutes: 15,
    ingredientLines: [...ingredientLines],
    steps: [{ instruction: 'Mix and cook.' }],
});

/** A snapshot line as the matcher would leave it. */
function line(sourceLine: string, name: string, overrides: Partial<NewImportLine> = {}): NewImportLine {
    return {
        lineIndex: 0,
        foodIndex: 0,
        sourceLine,
        lineDigest: `ld-${name}`,
        judgementDigest: `jd-${name}`,
        phrase: name,
        quantity: '2',
        quantityHigh: null,
        unit: 'cup',
        statedQuantity: null,
        statedQuantityHigh: null,
        statedUnit: null,
        preparation: null,
        name,
        displayText: null,
        note: null,
        matchedBy: null,
        foodId: null,
        foodVariantId: null,
        rung: null,
        margin: null,
        candidates: [],
        verificationKey: null,
        review: null,
        ...overrides,
    };
}

/** The advance service over the real import DALs and the booted app's own collaborators. */
function composeAdvance(app: BootedRecipeApp['app'], db: RecipeDrizzle): ImportAdvanceService {
    const imports = new RecipeImportsDal(db);
    const allowance = new ImportAllowanceDal();
    const items = new RecipeImportItemsDal(db, allowance);
    const lines = new RecipeImportLinesDal(db);
    const recipes = app.get(RecipesService);
    const slots = privateSlotsOf(recipes);

    return new ImportAdvanceService(
        imports,
        items,
        lines,
        app.get(ParseJobsService),
        app.get(PARSE_JOB_MATCHES_DAL),
        app.get(MatchProposalService),
        new ImportLineView(
            app.get(RECIPE_LINE_VERIFICATIONS_DAL),
            app.get(FoodRefsGateway),
            app.get(FoodLookupsDal),
            lines,
            app.get(CURATION_DISAGREEMENT_SINK),
        ),
        app.get(IngredientsService),
        recipes,
        slots,
        new ImportViewBuilder(imports, items, allowance, db, slots),
        DEFAULT_IMPORT_ADVANCE_LIMITS,
    );
}

interface ItemRow {
    readonly ordinal: number;
    readonly saved: boolean;
    readonly recipe_id: string | null;
    readonly held_at_rev: number | null;
    readonly decision_rev: number;
}

interface RecipeRow {
    readonly id: string;
    readonly title: string;
    readonly visibility: string;
    readonly source_type: string;
    readonly source_kind: string | null;
    readonly source_url: string | null;
}

describe('the bulk import saves through the real create path (LOCAL e2e, real Postgres)', () => {
    let importId: string;
    let lineIds: Map<number, string>;
    let items: ItemRow[];
    let recipes: RecipeRow[];

    beforeAll(async () => {
        food = await startFoodFake();
        food.foods.set(FLOUR, { name: 'Wheat flour', status: 'RESOLVED' });
        process.env['FOOD_SERVICE_URL'] = food.origin;

        booted = await bootRecipeApp({ databaseUrl: roleDb.appUrl, devAuthUserId: COOK });
        pool = new pg.Pool({ connectionString: roleDb.appUrl, max: 3 });

        const db = createRecipeDrizzle(pool);
        const imports = new RecipeImportsDal(db);
        const itemsDal = new RecipeImportItemsDal(db, new ImportAllowanceDal());
        const created = await imports.insertHeader(COOK, {
            id: crypto.randomUUID(),
            matchMode: 'bindBest',
            visibility: 'private',
            expectedTotal: 3,
        });

        if (created.kind === 'foreign') {
            throw new Error('unexpected foreign import');
        }

        importId = created.header.id;
        await itemsDal.upsertItems(importId, [
            {
                ordinal: WEB,
                recipe: recipe('web pancakes', ['2 cups flour'], 4),
                statement: { kind: 'public_web', citation: 'https://www.example.com/pancakes' },
            },
            {
                ordinal: BOOK,
                recipe: recipe('book stew', [`a pinch of ${SCOPE} mix`], 6),
                statement: { kind: 'book', citation: 'The Family Cookbook, page 12' },
            },
            {
                ordinal: HELD,
                recipe: recipe('no servings', ['2 cups flour']),
                statement: { kind: 'authored' },
            },
        ]);
        // Paid and parsed: the save is what this suite is about, and a parse job lives in another service's queue.
        await pool.query(
            `UPDATE recipe_import_items SET stage = 'parsing', allowance_spent_at = now() WHERE import_id = $1`,
            [importId],
        );

        const flourLine = line('2 cups flour', 'flour', {
            matchedBy: 'lexical',
            foodId: FLOUR,
            rung: 'head',
            margin: 0.4,
            candidates: [{ kind: 'root', id: FLOUR, rung: 'head', isDefault: false }],
            verificationKey: `${SCOPE}-key`,
            review: 'owed',
        });

        await itemsDal.snapshot(importId, WEB, [flourLine]);
        await itemsDal.snapshot(importId, BOOK, [line(`a pinch of ${SCOPE} mix`, `${SCOPE} mix`, { quantity: null })]);
        await itemsDal.snapshot(importId, HELD, [flourLine]);

        const snapshotted = await pool.query<{ ordinal: number; id: string }>(
            `SELECT ordinal, id::text AS id FROM recipe_import_lines WHERE import_id = $1`,
            [importId],
        );

        lineIds = new Map(snapshotted.rows.map((row) => [row.ordinal, row.id]));

        const advance = composeAdvance(booted.app, db);
        const caller = CallerToken.fromAuthorizationHeader(bearerFor(COOK));

        // Each advance does a bounded step; three is more than three items need.
        for (let step = 0; step < 3; step += 1) {
            await advance.advance(makePrincipal({ userId: COOK }), caller, importId);
        }

        items = (
            await pool.query<ItemRow>(
                `SELECT ordinal, saved_at IS NOT NULL AS saved, recipe_id::text AS recipe_id, held_at_rev, decision_rev
                   FROM recipe_import_items WHERE import_id = $1 ORDER BY ordinal`,
                [importId],
            )
        ).rows;
        recipes = (
            await pool.query<RecipeRow>(
                `SELECT id::text AS id, title, visibility, source_type, source_kind, source_url
                   FROM recipes WHERE owner_id = $1 ORDER BY title`,
                [COOK],
            )
        ).rows;
    });

    afterAll(async () => {
        if (pool !== undefined) {
            await pool.query(`DELETE FROM recipes WHERE owner_id = $1`, [COOK]);
            await pool.query(`DELETE FROM recipe_imports WHERE user_id = $1`, [COOK]);
            await deleteBindingsMatching(pool, `${SCOPE}%`);
            await pool.end();
        }

        await booted?.close();
        await food?.close();
    });

    const recipeTitled = (title: string) => recipes.find((row) => row.title === `${SCOPE} ${title}`);
    const itemAt = (ordinal: number) => items.find((row) => row.ordinal === ordinal);

    async function originsOf(recipeId: string | undefined): Promise<(string | null)[][]> {
        const { rows } = await pool.query<{ bound_by: string | null; import_line_id: string | null }>(
            `SELECT bound_by, import_line_id::text AS import_line_id FROM ingredients WHERE recipe_id = $1 ORDER BY sort_order`,
            [recipeId],
        );

        return rows.map((row) => [row.bound_by, row.import_line_id]);
    }

    it('saves the web copy as imported_public from public_web, private as the cook chose', () => {
        expect(recipeTitled('web pancakes')).toMatchObject({
            visibility: 'private',
            source_type: 'imported_public',
            source_kind: 'public_web',
            source_url: 'https://www.example.com/pancakes',
        });
    });

    it('saves the book recipe as imported_physical, private', () => {
        expect(recipeTitled('book stew')).toMatchObject({
            visibility: 'private',
            source_type: 'imported_physical',
            source_kind: 'book',
        });
    });

    it('writes the line origins: a bound line is autoBest with its link, a line kept as written has its link only', async () => {
        expect(await originsOf(recipeTitled('web pancakes')?.id)).toStrictEqual([['autoBest', lineIds.get(WEB)]]);
        expect(await originsOf(recipeTitled('book stew')?.id)).toStrictEqual([[null, lineIds.get(BOOK)]]);
    });

    it('claims each saved item with the id of the recipe that was written', () => {
        expect(itemAt(WEB)).toMatchObject({ saved: true, recipe_id: recipeTitled('web pancakes')?.id });
        expect(itemAt(BOOK)).toMatchObject({ saved: true, recipe_id: recipeTitled('book stew')?.id });
    });

    it('⛔ holds the item with no servings at the revision the save read, and writes no recipe for it', () => {
        const held = itemAt(HELD);

        expect(held).toMatchObject({ saved: false, recipe_id: null });
        expect(held?.held_at_rev).toBe(held?.decision_rev);
        expect(recipeTitled('no servings')).toBeUndefined();
    });
});
