/**
 * U4 — THE LEXICAL TIER IN THE REAL PROPOSAL CHAIN (plan U4; ADR-0070, ADR-0071), on a developer's machine.
 *
 * The unit suite (`resolution/__tests__/lexicalTier.test.ts`) proves the tier's judgement against a mocked gateway.
 * This suite runs the tier where production runs it, the paste matcher's proposal chain, against a REAL migrated
 * PostgreSQL, because three of its claims are invisible to a mock:
 *
 *  1. **Consultation order against a real mapping row.** `['curated', 'memo', 'lexical']` is the PRECEDENCE
 *     (`resolutionRegistry.ts`). Only the real registry reading a real mapping row proves a curated answer is the
 *     proposal while the catalog is still searched once beside it, for the candidates (ADR-0071 decision 5).
 *  2. **The proposal round-trips through the real table.** The rung, the margin and the JSONB candidates are read back
 *     from `recipe_parse_job_matches`, including a rung-less hit stored with no rung.
 *  3. **The reach.** The cascade is consulted on the paste matcher and on by-name's settled chain, and nowhere else:
 *     the read route (`/search`) presents foods to a human who decides, and admits nothing.
 *
 * ⚠️ Re-targeted (ADR-0071). This suite drove `IngredientsService.addByName` with the proposal chain injected and
 * asserted the ranked resolution EVENT (its KTD-C shortlist through JSONB, and R20's `author_augmented`). By-name now
 * runs the settled chain only, and that event write and its read were deleted as unreachable, so those two cases went
 * with them. The tier's cases now assert the matcher's stored proposal instead.
 *
 * The food service is stubbed at its client boundary; the GATEWAY above it is real, so the availability discipline
 * (`ok` / `disabled` / degraded) under test is the production one.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi, type Mock } from 'vitest';
import pg from 'pg';

import { FoodResolutionStatus } from '@kitchensink/recipe-core';
import { lineDigest } from '@kitchensink/recipe-core/parsing/parse-key';
import type { FoodRef, FoodServiceClient } from '@kitchensink/food-service-client';

import type { Principal } from '../../../src/auth/principal.js';
import { sha256Hex } from '../../../src/common/sha256.js';
import { createRecipeDrizzle, type RecipeDrizzle } from '../../../src/database/client.js';
import { FoodLookupsDal } from '../../../src/ingredients/dal/foodLookups.dal.js';
import { CURATOR_MAPPING_SCOPE } from '../../../src/ingredients/domain/mappingScopePolicy.js';
import { FoodCatalogGateway } from '../../../src/ingredients/foodCatalog.gateway.js';
import { FoodRefsGateway } from '../../../src/ingredients/foodRefs.gateway.js';
import { IngredientsService } from '../../../src/ingredients/ingredients.service.js';
import { IngredientResolutionsDal } from '../../../src/ingredients/resolution/ingredientResolutions.dal.js';
import { MappingPromotionAudit } from '../../../src/ingredients/resolution/mappingPromotionAudit.js';
import { ResolutionMappingsDal } from '../../../src/ingredients/resolution/resolutionMappings.dal.js';
import { ResolutionMappingsService } from '../../../src/ingredients/resolution/resolutionMappings.service.js';
import {
    createBindingRegistry,
    createProposalRegistry,
} from '../../../src/ingredients/resolution/resolutionRegistry.js';
import { CALLER_TOKEN as CALLER } from '../../../src/ingredients/__fixtures__/ingredients.fixtures.js';
import { fakeVerificationQueue } from '../../../src/recipes/__fixtures__/verificationQueue.fixture.js';
import { LineVerificationsDal } from '../../../src/recipes/dal/lineVerifications.dal.js';
import { ParseJobMatchesDal } from '../../../src/recipes/dal/parseJobMatches.dal.js';
import { ParseJobsDal } from '../../../src/recipes/dal/parseJobs.dal.js';
import { MatchProposalService } from '../../../src/recipes/matchProposal.service.js';
import { deleteBindingsMatching } from '../../support/bindingCleanup.js';
import { recipeDb } from '../../support/roleDb.js';

const roleDb = recipeDb();
/** Every phrase this suite matches shares this prefix, so cleanup is exact. */
const PREFIX = 'u4 lexical';

const TOP_FOOD = '01JU4LEXICAL00000000000TOP';
const RUNNER_FOOD = '01JU4LEXICAL0000000RUNNER1';
const CURATED_FOOD = '01JU4LEXICAL000000CURATED1';
const EGGPLANT_FOOD = '01JU4LEXICAL00000EGGPLANT1';

const AUTHOR = '01JU4LEXICAL000000000AUTHR';
const CURATOR = '01JU4LEXICAL00000000CURATR';

/** A principal with the given grants. */
function principal(userId: string, scopes: string[] = []): Principal {
    return {
        userId,
        sub: `clerk_${userId}`,
        scopes,
        permissions: [],
        roles: [],
        principalKind: 'real',
        containment: 'enforce',
    };
}

/**
 * One food-service search row, in the wire spelling the gateway narrows. A NAME hit carries the rung food ranked it on
 * (ADR-0070); `rung: undefined` builds a crosswalk hit or an unknown rung, on purpose.
 */
function searchRow(
    id: string,
    name: string,
    score: number,
    options: { readonly rung?: 'head' | 'base' | undefined } = { rung: 'head' },
) {
    return {
        id,
        name,
        score,
        ...(options.rung === undefined ? {} : { rung: options.rung }),
        caloriesPer100g: 364,
        proteinGPer100g: 10.3,
    };
}

/** One stored match row, as the matcher wrote it. */
interface StoredMatch {
    readonly matched_by: string | null;
    readonly food_id: string | null;
    readonly rung: string | null;
    readonly margin: number | null;
    readonly candidates: readonly { kind: string; id: string; rung: string | null }[];
}

describe('U4 — the lexical tier inside the real proposal chain', () => {
    let pool: pg.Pool;
    let db: RecipeDrizzle;
    let mappings: ResolutionMappingsDal;
    let corrections: ResolutionMappingsService;
    let foodClient: {
        search: ReturnType<typeof vi.fn>;
        addByName: ReturnType<typeof vi.fn>;
        resolveRefs: Mock<FoodServiceClient['resolveRefs']>;
    };

    /** The food clients, all answering from the one stubbed client. */
    const clients = (): never =>
        ({
            standard: () => foodClient as unknown as FoodServiceClient,
            typeahead: () => foodClient as unknown as FoodServiceClient,
            readClient: () => foodClient as unknown as FoodServiceClient,
            readDeadlineMs: () => 5_000,
        }) as never;

    /** The matcher over the REAL registry, gateway and tables, with a blend switch the test controls. */
    function matcherWith(enabled: boolean): MatchProposalService {
        const catalog = new FoodCatalogGateway(clients(), { enabled });

        return new MatchProposalService(
            new ParseJobsDal(db, pool),
            new ParseJobMatchesDal(db),
            createProposalRegistry(mappings, catalog, { onUnrankedHits: () => undefined }),
            catalog,
            new FoodRefsGateway(clients()),
            fakeVerificationQueue(),
            new LineVerificationsDal(db),
        );
    }

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: roleDb.appUrl });
        db = createRecipeDrizzle(pool);
        mappings = new ResolutionMappingsDal(db);
        corrections = new ResolutionMappingsService(mappings, {
            recordPromotion: vi.fn(),
        } as unknown as MappingPromotionAudit);

        foodClient = { search: vi.fn(), addByName: vi.fn(), resolveRefs: vi.fn() };
    });

    afterEach(async () => {
        // ⛔ RESET, not CLEAR: a queued `mockResolvedValueOnce` left behind would be served to the NEXT spec.
        vi.resetAllMocks();
        await pool.query('DELETE FROM recipe_parse_jobs WHERE owner_id = $1', [AUTHOR]);
        await pool.query('DELETE FROM ingredient_resolution_mappings WHERE normalized_key LIKE $1', [`${PREFIX}%`]);
        await deleteBindingsMatching(pool, `${PREFIX}%`);
        await deleteBindingsMatching(pool, '01JU4LEXICAL%');
    });

    afterAll(async () => {
        await pool.end();
    });

    /** Point `resolveRefs` at the given foods, each found and named; any other food is `absent`. */
    function foodsFound(named: Record<string, string>): void {
        foodClient.resolveRefs.mockImplementation(async (refs: readonly FoodRef[]) => ({
            entries: refs.map((ref) =>
                named[ref.id] === undefined
                    ? { outcome: 'absent' as const, ref }
                    : { outcome: 'found' as const, ref, name: named[ref.id], status: FoodResolutionStatus.RESOLVED },
            ),
        }));
    }

    /** A live job with ONE parsed line naming `${PREFIX} ${phrase}`, as the worker would land it. */
    async function pastedJob(phrase: string): Promise<string> {
        const name = `${PREFIX} ${phrase}`;
        const sourceLine = `2 cups ${name}`;
        const job = await pool.query<{ id: string }>(
            `INSERT INTO recipe_parse_jobs (owner_id, expires_at, status)
             VALUES ($1, now() + interval '1 day', 'complete') RETURNING id`,
            [AUTHOR],
        );
        const id = job.rows[0]?.id ?? '';
        const proposal = {
            raw: sourceLine,
            quantity: { kind: 'exact', value: 2 },
            unit: 'cup',
            statedMeasure: '2 cups',
            foods: [{ name, prep: null }],
            reviewReasons: [],
        };

        await pool.query(
            `INSERT INTO recipe_parse_job_lines (job_id, line_index, source_line, line_digest, status, proposal)
             VALUES ($1, 0, $2, $3, 'parsed', $4::jsonb)`,
            [id, sourceLine, lineDigest(sourceLine, sha256Hex), JSON.stringify(proposal)],
        );

        return id;
    }

    /** Propose for a fresh one-line job and read back the row the matcher stored, if any. */
    async function proposeFor(phrase: string, enabled = true): Promise<StoredMatch | undefined> {
        const jobId = await pastedJob(phrase);

        await matcherWith(enabled).propose(principal(AUTHOR), CALLER, jobId);

        const rows = await pool.query<StoredMatch>(
            `SELECT matched_by, food_id, rung, margin, candidates FROM recipe_parse_job_matches WHERE job_id = $1`,
            [jobId],
        );

        return rows.rows[0];
    }

    it('proposes the ranked top hit, and its rung, margin and candidates round-trip through the real table', async () => {
        foodClient.search.mockResolvedValue({
            results: [
                searchRow(TOP_FOOD, 'Flour, wheat, all-purpose', 0.91),
                searchRow(RUNNER_FOOD, 'Carob flour', 0.62),
            ],
        });
        foodsFound({ [TOP_FOOD]: 'Flour, wheat, all-purpose', [RUNNER_FOOD]: 'Carob flour' });

        const stored = await proposeFor('flour');

        // A proposal binds nothing: food's add-by-name is never reached.
        expect(foodClient.addByName).not.toHaveBeenCalled();
        expect(stored).toMatchObject({ matched_by: 'lexical', food_id: TOP_FOOD, rung: 'head' });
        expect(stored?.margin).toBeCloseTo(0.29, 5);
        expect(stored?.candidates).toEqual([
            { kind: 'root', id: TOP_FOOD, rung: 'head' },
            { kind: 'root', id: RUNNER_FOOD, rung: 'head' },
        ]);
    });

    it('⛔ a CROSSWALK top hit (score 1, no rung) is proposed with no rung, keeping its margin and candidates', async () => {
        foodClient.search.mockResolvedValue({
            results: [
                searchRow(TOP_FOOD, 'Flour, wheat, all-purpose', 1, { rung: undefined }),
                searchRow(RUNNER_FOOD, 'Carob flour', 0.62),
            ],
        });
        foodsFound({ [TOP_FOOD]: 'Flour, wheat, all-purpose', [RUNNER_FOOD]: 'Carob flour' });

        const stored = await proposeFor('crosswalk flour');

        expect(stored).toMatchObject({ matched_by: 'lexical', food_id: TOP_FOOD, rung: null });
        expect(stored?.margin).toBeCloseTo(0.38, 5);
        expect(stored?.candidates[0]).toStrictEqual({ kind: 'root', id: TOP_FOOD, rung: null });
    });

    it('⛔ a CURATED mapping is the proposal (R11 precedence), and the catalog is searched once beside it', async () => {
        await corrections.recordCorrection({
            principal: principal(CURATOR, [CURATOR_MAPPING_SCOPE]),
            phrase: `${PREFIX} plain flour`,
            food: { kind: 'root', id: CURATED_FOOD },
            surfacing: 'row_rebind',
        });
        foodClient.search.mockResolvedValue({ results: [searchRow(TOP_FOOD, 'Flour, wheat, all-purpose', 0.99)] });
        foodsFound({ [CURATED_FOOD]: 'Flour, wheat, all-purpose', [TOP_FOOD]: 'Flour, wheat, bread' });

        const stored = await proposeFor('plain flour');

        expect(stored).toMatchObject({ matched_by: 'curated', food_id: CURATED_FOOD });
        // The shortlist runs for every proposal (ADR-0071 decision 5): it supplies the candidates and the default.
        expect(foodClient.search).toHaveBeenCalledTimes(1);
        expect(stored?.candidates.map((candidate) => candidate.id)).toStrictEqual([CURATED_FOOD, TOP_FOOD]);
    });

    it('an EMPTY catalog stores a no-match row — a deterministic answer, never a false proposal', async () => {
        foodClient.search.mockResolvedValue({ results: [] });

        const stored = await proposeFor('blorvik');

        expect(stored).toMatchObject({ matched_by: null, food_id: null, candidates: [] });
        expect(foodClient.addByName).not.toHaveBeenCalled();
    });

    it('the synonym reformulation retries ONCE, and the retried hit is the proposal (origin D11)', async () => {
        foodClient.search
            .mockResolvedValueOnce({ results: [] })
            .mockResolvedValueOnce({ results: [searchRow(EGGPLANT_FOOD, 'Eggplant, raw', 0.9)] });
        foodsFound({ [EGGPLANT_FOOD]: 'Eggplant, raw' });

        const stored = await proposeFor('aubergine');

        expect(foodClient.search).toHaveBeenCalledTimes(2);
        expect(stored).toMatchObject({ matched_by: 'lexical', food_id: EGGPLANT_FOOD });
    });

    it('⛔ a DISABLED blend stores NOTHING and searches nothing — a no-match then would stick', async () => {
        const stored = await proposeFor('switched off', false);

        expect(foodClient.search).not.toHaveBeenCalled();
        expect(stored).toBeUndefined();
    });

    it('⛔ THE CASCADE IS THE WRITE PATH’S — the filter search resolves nothing and admits nothing', async () => {
        // Ran on the blended `/suggest` typeahead until plan 002 S6 deleted it; `/search` is the read left. Built as
        // production builds by-name: the settled chain.
        const catalog = new FoodCatalogGateway(clients(), { enabled: true });
        const ingredients = new IngredientsService(
            new FoodLookupsDal(db),
            clients(),
            catalog,
            new FoodRefsGateway(clients()),
            createBindingRegistry(mappings),
            new IngredientResolutionsDal(db),
        );

        foodClient.search.mockResolvedValue({ results: [searchRow(TOP_FOOD, 'Flour, wheat, all-purpose', 0.91)] });

        const found = await ingredients.search(CALLER, `${PREFIX} flour`, AUTHOR, 5);

        // The catalog hit has no binding, so the search returns nothing for it and binds nothing: no binding, no
        // provenance event, no bind-check `refs/resolve` round-trip, and no verification obligation on a read.
        expect(found).toStrictEqual([]);
        expect(foodClient.resolveRefs).not.toHaveBeenCalled();

        const { rows } = await pool.query('SELECT id FROM food_lookups WHERE food_id = $1', [TOP_FOOD]);

        expect(rows).toHaveLength(0);
    });
});
