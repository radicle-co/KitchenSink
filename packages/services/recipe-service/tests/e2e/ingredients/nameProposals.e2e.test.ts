/**
 * THE ADD FIELD'S SUGGESTIONS, PROVED AGAINST A REAL DATABASE — what the settled tiers remember is OFFERED and never
 * bound (owner rulings 2026-11-03; ADR-0071 as amended; devil's advocate M2).
 *
 * ## Why this tier and not the mocked guards beside it
 *
 * `nameProposals.service.test.ts` proves the policy with doubled tiers, and `byNameBindsNoRankedGuess.integration.test.ts`
 * proves the route over doubled repositories. What neither can prove is that the REAL memo and mapping reads feed the
 * proposals: the memo tier answers only on an exact stored key (a trigram neighbour passes), and the curated tier's
 * own-before-global sort key lives in SQL. A stub returning a hit demonstrates none of that.
 *
 * ## What each spec would have caught
 *
 *  - **The memo case** is M2: a memo one cook's save taught is a PROPOSAL for the next cook, not a binding.
 *  - **The own-correction case** pins that a cook's private correction is offered to that cook alone.
 *  - **The near-twin case** pins that a trigram neighbour is not a proposal either: nobody agreed that phrase.
 *  - **The writes-nothing case** is the point of the route: after every read above, no binding exists for the phrase.
 *
 * The food service is stubbed at its client boundary, the one dependency recipe-service does not own.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi, type Mock } from 'vitest';
import pg from 'pg';

import { normalizedIngredientKey } from '@kitchensink/recipe-core/resolution/normalized-key';
import type { FoodRef, FoodServiceClient } from '@kitchensink/food-service-client';

import { createRecipeDrizzle, type RecipeDrizzle } from '../../../src/database/client.js';
import { FoodRefsGateway } from '../../../src/ingredients/foodRefs.gateway.js';
import { NameProposalsService } from '../../../src/ingredients/nameProposals.service.js';
import { ResolutionMappingsDal } from '../../../src/ingredients/resolution/resolutionMappings.dal.js';
import { createBindingRegistry } from '../../../src/ingredients/resolution/resolutionRegistry.js';
import {
    CALLER_TOKEN as CALLER,
    foodClientsOf,
    makeCanonicalName,
} from '../../../src/ingredients/__fixtures__/ingredients.fixtures.js';
import { deleteBindingsMatching } from '../../support/bindingCleanup.js';
import { recipeDb } from '../../support/roleDb.js';

const roleDb = recipeDb();

const MEMO_FOOD = '01JU11PROP0000000000MEMOFD';
const RULED_FOOD = '01JU11PROP00000000RULEDFOOD';
const OWN_FOOD = '01JU11PROP000000000OWNFOOD';

const COOK = '01JU11PROP00000000000COOK1';
const OTHER_COOK = '01JU11PROP00000000000COOK2';
const VERIFIER = 'test-model-v1';

/** Every phrase this suite writes shares this prefix, so cleanup is exact. */
const PREFIX = 'u11 proposals';

describe('name proposals against a real knowledge base', () => {
    let pool: pg.Pool;
    let db: RecipeDrizzle;
    let foodClient: { addByName: Mock; resolveRefs: Mock };
    let proposals: NameProposalsService;

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: roleDb.appUrl });
        db = createRecipeDrizzle(pool);
        foodClient = { addByName: vi.fn(), resolveRefs: vi.fn() };

        // ⛔ THE REAL BINDING REGISTRY, not a hand-listed pair: the proposals read the same settled chain production builds.
        proposals = new NameProposalsService(
            createBindingRegistry(new ResolutionMappingsDal(db)),
            new FoodRefsGateway(foodClientsOf(foodClient as unknown as FoodServiceClient)),
        );
    });

    afterEach(async () => {
        foodClient.resolveRefs.mockReset();
        foodClient.addByName.mockReset();
        await pool.query('DELETE FROM ingredient_resolution_memos WHERE normalized_key LIKE $1', [`${PREFIX}%`]);
        await pool.query('DELETE FROM ingredient_resolution_mappings WHERE normalized_key LIKE $1', [`${PREFIX}%`]);
        await deleteBindingsMatching(pool, `${PREFIX}%`);
        await deleteBindingsMatching(pool, '01JU11PROP%');
    });

    afterAll(async () => {
        await pool.end();
    });

    /** Food answers `found`, RESOLVED and named, for every id in `names`, and `absent` for the rest. */
    function foodNames(names: Readonly<Record<string, string>>): void {
        foodClient.resolveRefs.mockImplementation(async (refs: readonly FoodRef[]) => ({
            entries: refs.map((ref) =>
                names[ref.id] === undefined
                    ? { outcome: 'absent', ref }
                    : { outcome: 'found', ref, name: names[ref.id], status: 'RESOLVED' },
            ),
        }));
    }

    async function remember(phrase: string, foodId: string): Promise<void> {
        await pool.query(
            `INSERT INTO ingredient_resolution_memos (normalized_key, food_id, source_phrase, verified_by)
             VALUES ($1, $2, $3, $4)`,
            [normalizedIngredientKey(`${PREFIX} ${phrase}`), foodId, `${PREFIX} ${phrase}`, VERIFIER],
        );
    }

    async function map(
        phrase: string,
        foodId: string,
        scope: 'author' | 'global',
        userId: string | null,
    ): Promise<void> {
        await pool.query(
            `INSERT INTO ingredient_resolution_mappings
                 (normalized_key, food_id, scope, origin, user_id, source_phrase, surfacing)
             VALUES ($1, $2, $3, $4, $5, $6, 'integration_fixture')`,
            [
                normalizedIngredientKey(`${PREFIX} ${phrase}`)!,
                foodId,
                scope,
                scope === 'author' ? 'author' : 'curator',
                userId,
                `${PREFIX} ${phrase}`,
            ],
        );
    }

    const propose = (phrase: string, userId: string | undefined) =>
        proposals.propose(CALLER, makeCanonicalName(`${PREFIX} ${phrase}`), userId);

    it('M2: a memo another cook\'s save taught is OFFERED to this cook as "remembered"', async () => {
        await remember('milk', MEMO_FOOD);
        foodNames({ [MEMO_FOOD]: 'Whole milk' });

        const answer = await propose('milk', COOK);

        expect(answer.proposals).toStrictEqual([
            { kind: 'root', id: MEMO_FOOD, name: 'Whole milk', source: 'remembered' },
        ]);
    });

    it('offers a staff ruling before a memo, and both', async () => {
        await remember('salt', MEMO_FOOD);
        await map('salt', RULED_FOOD, 'global', null);
        foodNames({ [MEMO_FOOD]: 'Sea salt', [RULED_FOOD]: 'Table salt' });

        const answer = await propose('salt', COOK);

        expect(answer.proposals.map((proposal) => [proposal.id, proposal.source])).toStrictEqual([
            [RULED_FOOD, 'staffRuling'],
            [MEMO_FOOD, 'remembered'],
        ]);
    });

    it('offers a cook their OWN correction first, and offers it to nobody else', async () => {
        await map('bread', OWN_FOOD, 'author', COOK);
        await remember('bread', MEMO_FOOD);
        foodNames({ [OWN_FOOD]: 'Sourdough', [MEMO_FOOD]: 'White bread' });

        const mine = await propose('bread', COOK);
        const theirs = await propose('bread', OTHER_COOK);

        expect(mine.proposals.map((proposal) => proposal.source)).toStrictEqual(['ownCorrection', 'remembered']);
        expect(theirs.proposals.map((proposal) => proposal.source)).toStrictEqual(['remembered']);
    });

    it('⛔ a NEAR-TWIN of a remembered phrase is not offered: nobody agreed that phrase', async () => {
        await remember('caster sugar', MEMO_FOOD);
        foodNames({ [MEMO_FOOD]: 'Caster sugar' });

        const answer = await propose('castor sugar', COOK);

        expect(answer.proposals).toStrictEqual([]);
    });

    it('drops a remembered food food no longer shows, and still answers', async () => {
        await remember('cinnamon', MEMO_FOOD);
        foodNames({});

        await expect(propose('cinnamon', COOK)).resolves.toMatchObject({ proposals: [] });
    });

    it('⛔ WRITES NOTHING: after offering, no binding exists for the phrase and food was never asked to add it', async () => {
        await remember('flour', MEMO_FOOD);
        foodNames({ [MEMO_FOOD]: 'Plain flour' });

        await propose('flour', COOK);

        const { rows } = await pool.query<{ count: string }>(`SELECT count(*) FROM food_lookups WHERE food_id = $1`, [
            MEMO_FOOD,
        ]);
        expect(Number(rows[0]?.count)).toBe(0);
        expect(foodClient.addByName).not.toHaveBeenCalled();
    });
});
