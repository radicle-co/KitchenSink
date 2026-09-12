/**
 * ⛔ THE PRODUCER SEAM (plan U11 / ADR-0024) — written BEFORE the wiring (TDD red → green).
 *
 * U11 shipped the verification gate's CONSUMER and never shipped its producer: `verifyLine.ts` was deployed,
 * IAM'd, alarmed and given a queue, and nothing in the tree sent it a message. These cases are the seam that
 * closes that, pinned at the ONE layer that holds every field the contract needs — `recipeId` from the write,
 * `sourceLine`/`quantity`/`unit` from the persisted line, `foodId` from the binding and `candidateFoodName` from
 * food's answer about it (plan 002 R9).
 *
 * The four properties, each written against a specific way of getting this wrong:
 *
 *  1. **A save enqueues after it persists, and never before.** The message carries the recipe's id, so a
 *     producer that ran first would have nothing to name.
 *  2. **⛔ AN ENQUEUE FAILURE MUST NOT FAIL THE SAVE.** The gate is a quality enhancement on an ASYNC path,
 *     and `0023_line_verifications.sql` establishes that absence of a verdict means PUBLISH — so a lost
 *     message degrades to exactly the behaviour the system had before the gate existed. Letting SQS take down
 *     `POST /api/v1/recipes` would trade a quality improvement for an availability regression.
 *  3. **An UPDATE never re-asks about a judgement already on record.** `replaceForRecipe` rewrites every
 *     ingredient row on every save and both shipped clients send `ingredients` on every save, so the naive
 *     producer re-pays for a whole recipe when a title changes.
 *  4. **⚠️ An UPDATE asks nothing AT ALL today, and the two cases below say why.** An unchanged line is
 *     filtered as already-requested; a CHANGED line loses its transcription to the carry-forward rule and is
 *     no longer verifiable. That is a consequence of `domain/transcriptionCarryForward.ts`, recorded here rather
 *     than discovered later — and it is the right outcome, because verifying our parse of an author's
 *     correction against the source they overrode would manufacture a wrong DISAGREE.
 *
 * ⛔ THERE IS DELIBERATELY NO "QUEUE IS DOWN" CASE ON THE UPDATE PATH. One was written and DELETED: because
 * of (4) the update path never reaches a send, so `mockRejectedValue` never fired and the case would have
 * passed with the whole `requestVerification` call removed. That is the definition of coverage theater, and
 * a test that cannot fail must not be counted. The containment property is proved on the CREATE path, which
 * does reach the send; if (4) ever stops holding, the case belongs back here with a fixture that reaches it.
 *
 * The message CONTENT rules are a truth table in `domain/__tests__/verificationRequests.test.ts`; this file
 * is about the orchestration around them — ordering, failure containment, and which lines reach the policy.
 */
import { describe, expect, it, vi } from 'vitest';

// The issue path is a different product from the log line, so it needs its own observation point.
const { mockCaptureException } = vi.hoisted(() => ({ mockCaptureException: vi.fn() }));

vi.mock('@sentry/nestjs', () => ({
    captureException: mockCaptureException,
    getClient: () => undefined,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { PREMIUM_PERMISSION, RecipesService } from '../recipes.service.js';
import { fakeVerificationQueue } from '../__fixtures__/verificationQueue.fixture.js';
import type { RecipeAggregate, RecipesDal } from '../dal/recipes.dal.js';
import { FoodResolutionStatus } from '@kitchensink/recipe-core';
import { verificationKey } from '@kitchensink/recipe-core/resolution/verification-key';
import { sha256Hex } from '../../common/sha256.js';
import type { FoodLookupArm, FoodRef } from '../../database/schema/foodLookupArm.js';
import { fakeFoodLookupsDal, makeRootArm } from '../../ingredients/__fixtures__/foodLookups.fixture.js';
import type { FoodRefAnswer } from '../../ingredients/domain/foodRefAnswer.js';
import { canonicalIngredientName } from '../../ingredients/domain/ingredientName.js';
import type { FoodRefsGateway } from '../../ingredients/foodRefs.gateway.js';
import { makeFakeIngredientResolutionsDal } from '../../ingredients/__fixtures__/resolutionDals.fixture.js';
import type { IngredientResolutionsDal } from '../../ingredients/resolution/ingredientResolutions.dal.js';
import { makeIngredientLineRow, makeRecipeRow, makeRecipeStepRow } from '../../__fixtures__/index.js';
import { fakeLineVerificationsDal } from '../__fixtures__/lineVerificationsDal.fixture.js';
import type { LineVerificationsDal } from '../dal/lineVerifications.dal.js';
import type { CreateRecipeDto } from '../dto/createRecipe.dto.js';
import type { UpdateRecipeDto } from '../dto/updateRecipe.dto.js';
import type { Principal } from '../../auth/principal.js';
import { FAKE_TX } from '../__fixtures__/recipesDal.fixture.js';
import type { RecipeTx } from '../../database/unitOfWork.js';
import { makeRecipesService } from '../__fixtures__/recipesService.fixture.js';

/** A `FoodNutritionGateway` double: this suite is not about nutrition, so it degrades honestly. */
const nutritionGatewayDouble = {
    lookup: async (_caller: unknown, ids: readonly string[]) => ({ byFoodId: new Map(), unansweredIds: new Set(ids) }),
} as never;

const OWNER = '01J000000000000000000FREE0';
const OWNER_PRINCIPAL: Principal = {
    userId: OWNER,
    sub: 'user_clerk',
    scopes: [],
    permissions: [],
    principalKind: 'real',
    containment: 'enforce',
};

const RECIPE_ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
const FLOUR_INGREDIENT_ID = '00000000-0000-4000-8000-00000000f10a';
const FLOUR_FOOD_ID = '01JFOOD000000000000000000';
const SOURCE_LINE = '2 cups all-purpose flour, sifted';

/** The line's binding: a shared root food, so the gate has an identity to check. */
const FLOUR = makeRootArm({ lookupId: FLOUR_INGREDIENT_ID, foodId: FLOUR_FOOD_ID });

/** Food's answer about the flour: live, and named. */
const FLOUR_NAMED: FoodRefAnswer = {
    outcome: 'found',
    name: canonicalIngredientName('Flour, wheat, all-purpose'),
    status: 'RESOLVED',
    isPrivate: false,
    rootId: FLOUR_FOOD_ID,
};

/** The persisted aggregate a save returns. `quantity`/`unit` mirror what the DTO stated. */
function aggregate(overrides: { sourceLine?: string | null; quantity?: string; unit?: string } = {}): RecipeAggregate {
    const recipe = makeRecipeRow({ id: RECIPE_ID, ownerId: OWNER });

    return {
        recipe,
        steps: [makeRecipeStepRow({ recipeId: recipe.id, stepNumber: 1, instruction: 'Mix' })],
        ingredients: [
            makeIngredientLineRow({
                recipeId: recipe.id,
                foodLookupId: FLOUR_INGREDIENT_ID,
                quantity: overrides.quantity ?? '2',
                unit: overrides.unit ?? 'cup',
                sortOrder: 0,
                sourceLine: overrides.sourceLine === undefined ? SOURCE_LINE : overrides.sourceLine,
            }),
        ],
    };
}

function fakeRecipesDal(overrides: Partial<RecipesDal> = {}): RecipesDal {
    return {
        create: vi.fn().mockResolvedValue(aggregate()),
        findById: vi.fn(),
        findAll: vi.fn(),
        update: vi.fn(),
        softDelete: vi.fn(),
        ...overrides,
        transaction: vi.fn(async (fn: (tx: RecipeTx) => Promise<unknown>) => fn(FAKE_TX)),
    } as unknown as RecipesDal;
}

/** A refs double answering `answer` about every reference. */
function refsAnswering(answer: FoodRefAnswer): FoodRefsGateway {
    return {
        resolve: vi.fn((_caller: unknown, refs: readonly FoodRef[]) =>
            Promise.resolve({
                answers: new Map(refs.map((ref) => [`${ref.kind}:${ref.id}`, answer])),
                degraded: false,
            }),
        ),
    } as unknown as FoodRefsGateway;
}

function makeService(
    dal: RecipesDal,
    queue: ReturnType<typeof fakeVerificationQueue>,
    options: {
        readonly arm?: FoodLookupArm;
        readonly answer?: FoodRefAnswer;
        readonly resolutions?: IngredientResolutionsDal;
        readonly verdicts?: LineVerificationsDal;
    } = {},
): RecipesService {
    // U14 — the verdict READER defaults to "the gate has judged nothing", which migration 0023 defines as PUBLISH,
    // so these producer cases exercise the pre-gate read behaviour they were written against.
    return makeRecipesService({
        dal,
        lookups: fakeFoodLookupsDal(options.arm ?? FLOUR),
        refs: refsAnswering(options.answer ?? FLOUR_NAMED),
        ingredientResolutions: options.resolutions ?? makeFakeIngredientResolutionsDal(),
        ...(options.verdicts === undefined ? {} : { lineVerificationsDal: options.verdicts }),
        foodNutrition: nutritionGatewayDouble,
        verificationQueue: queue,
    });
}

/** A create body. `sourceLine: null` means the cook AUTHORED the line — the field is simply not sent. */
const createDto = (sourceLine: string | null = SOURCE_LINE): CreateRecipeDto => ({
    title: 'Bread',
    servings: 2,
    prepTimeMinutes: 5,
    cookTimeMinutes: 10,
    totalTimeMinutes: 15,
    ingredients: [
        {
            ingredientId: FLOUR_INGREDIENT_ID,
            quantity: { kind: 'exact', value: 2 },
            unit: 'cup',
            ...(sourceLine !== null ? { sourceLine } : {}),
        },
    ],
    steps: [{ instruction: 'Mix' }],
});

describe('RecipesService.create — the verification producer', () => {
    it('U11/R20: stamps privateFood on the message when the line is bound to a PRIVATE food', async () => {
        // The owner is on the binding (plan 002), so the privacy fact can no longer fail to be read.
        const queue = fakeVerificationQueue();

        await makeService(fakeRecipesDal(), queue, {
            arm: { ...FLOUR, foodOwnerId: OWNER },
            answer: { ...FLOUR_NAMED, isPrivate: true } as FoodRefAnswer,
        }).create(OWNER_PRINCIPAL, createDto(), undefined);

        expect(queue.enqueue).toHaveBeenCalledTimes(1);
        expect(queue.enqueue.mock.calls[0]?.[0]?.[0]?.privateFood).toBe(true);
    });

    it('⛔ asks NOTHING about a line food could not name at save — the gate cannot judge an unnamed food', async () => {
        const queue = fakeVerificationQueue();

        const response = await makeService(fakeRecipesDal(), queue, { answer: { outcome: 'unreachable' } }).create(
            OWNER_PRINCIPAL,
            createDto(),
            undefined,
        );

        // The save landed; the line is simply not asked about, and absence of a verdict means PUBLISH (0023).
        expect(response.id).toBe(RECIPE_ID);
        expect(queue.enqueue).not.toHaveBeenCalled();
    });

    it('⛔ asks about the SAME food the detail read looks its verdict up under — one derivation, both ends', async () => {
        // The verdict the detail read finds is keyed on the identity THIS test derives from the binding's root
        // food. If the producer or the reader derived the food id another way, the verdict below would not be
        // found and the line would publish unjudged — silently, since a missing verdict publishes.
        const queue = fakeVerificationQueue();
        const key = verificationKey(
            {
                sourceLine: SOURCE_LINE,
                foodRefId: FLOUR_FOOD_ID,
                quantityLow: 2,
                quantityHigh: null,
                unit: 'cup',
                statedMeasure: null,
            },
            sha256Hex,
        );

        const response = await makeService(fakeRecipesDal(), queue, {
            verdicts: fakeLineVerificationsDal(new Map([[key, 'contradicted']])),
        }).create(OWNER_PRINCIPAL, createDto(), undefined);

        expect(queue.enqueue.mock.calls[0]?.[0]?.[0]?.foodId).toBe(FLOUR_FOOD_ID);
        expect(response.ingredients[0]?.resolutionStatus).toBe(FoodResolutionStatus.NEEDS_REVIEW);
    });

    it('enqueues one request for the transcribed, catalog-backed line, AFTER the write', async () => {
        const queue = fakeVerificationQueue();
        const dal = fakeRecipesDal();

        await makeService(dal, queue).create(OWNER_PRINCIPAL, createDto(), undefined);

        expect(queue.enqueue).toHaveBeenCalledTimes(1);
        // ⛔ AFTER the write, asserted rather than described: the message carries the PERSISTED recipe's id,
        // so a producer that ran first would have nothing to name — and it reads the persisted ROWS, whose
        // quantity has been through `numeric(10,3)`.
        expect(queue.enqueue.mock.invocationCallOrder[0]).toBeGreaterThan(
            (dal.create as unknown as { mock: { invocationCallOrder: number[] } }).mock.invocationCallOrder[0] ?? 0,
        );
        const [messages] = queue.enqueue.mock.calls[0] ?? [];

        expect(messages).toHaveLength(1);
        expect(messages?.[0]).toMatchObject({
            // ⛔ The PERSISTED recipe's id. A producer that ran before the write would have nothing to name.
            recipeId: RECIPE_ID,
            sourceLine: SOURCE_LINE,
            foodId: FLOUR_FOOD_ID,
            candidateFoodName: 'Flour, wheat, all-purpose',
            quantityLow: 2,
            quantityHigh: null,
            unit: 'cup',
        });
    });

    it('enqueues NOTHING when the line was authored rather than transcribed', async () => {
        const queue = fakeVerificationQueue();
        const dal = fakeRecipesDal({ create: vi.fn().mockResolvedValue(aggregate({ sourceLine: null })) });

        await makeService(dal, queue).create(OWNER_PRINCIPAL, createDto(null), undefined);

        // ⛔ Not "enqueued an empty batch" — the queue is not called at all. An empty `SendMessage` batch is a
        // round trip that can only fail.
        expect(queue.enqueue).not.toHaveBeenCalled();
    });

    it('⛔ still returns the created recipe when the queue is DOWN', async () => {
        // The gate is a quality enhancement on an ASYNC path, and absence of a verdict means PUBLISH — so a
        // lost message degrades to the behaviour the system had before the gate existed. Letting SQS take
        // down `POST /api/v1/recipes` would trade that improvement for an availability regression.
        const queue = fakeVerificationQueue();
        queue.enqueue.mockRejectedValue(new Error('sqs is unreachable'));
        const service = makeService(fakeRecipesDal(), queue);

        const response = await service.create(OWNER_PRINCIPAL, createDto(), undefined);

        expect(response.id).toBe(RECIPE_ID);
    });

    describe('ADR-0040 — a contained test principal asks the gate NOTHING', () => {
        const PREMIUM_OWNER: Principal = { ...OWNER_PRINCIPAL, permissions: [PREMIUM_PERMISSION] };

        // ⛔ The verification worker spends ADR-0024's shared production LLM pool and writes the GLOBAL
        // `ingredient_resolution_memos` tier, which carries no user column the test purge could reach. So on an
        // enforcing stage a test principal's save must not reach the queue at all — PREVENTED, like analytics,
        // because it cannot be cleaned up. The save itself still lands: absence of a verdict means PUBLISH (0023).
        it('enqueues nothing, and reads nothing for it, for a TEST principal on an ENFORCING stage', async () => {
            const queue = fakeVerificationQueue();
            const resolutions = makeFakeIngredientResolutionsDal();

            // A PREMIUM principal saving `private`, because a contained principal may not PUBLISH and a free-tier recipe
            // is public-only — the save must land for this case to prove anything about the enqueue that follows it.
            const response = await makeService(fakeRecipesDal(), queue, { resolutions }).create(
                { ...PREMIUM_OWNER, principalKind: 'test', containment: 'enforce' },
                { ...createDto(), visibility: 'private' },
                undefined,
            );

            expect(response.id).toBe(RECIPE_ID);
            expect(queue.enqueue).not.toHaveBeenCalled();
            // The early return is at the TOP: no provenance read is paid for a request never sent. Exactly ONE read
            // happens — the detail response's own pending read — so a producer read would be a second.
            expect(vi.mocked(resolutions.latestResolutionsByLookupIds).mock.calls).toHaveLength(1);
        });

        it.each([
            ['a REAL principal on an enforcing stage', { principalKind: 'real', containment: 'enforce' }],
            ['a TEST principal on a stage that does not contain', { principalKind: 'test', containment: 'off' }],
        ] as const)('still enqueues for %s', async (_label, subject) => {
            const queue = fakeVerificationQueue();

            await makeService(fakeRecipesDal(), queue).create(
                { ...PREMIUM_OWNER, ...subject },
                { ...createDto(), visibility: 'private' },
                undefined,
            );

            expect(queue.enqueue).toHaveBeenCalledTimes(1);
        });
    });
});

describe('RecipesService.update — the verification producer', () => {
    /** A stored recipe whose single line already carries the source line a request was made for. */
    const stored = (): RecipeAggregate => aggregate();

    const updateDto = (quantity: number): UpdateRecipeDto => ({
        expectedVersion: 1,
        ingredients: [
            {
                ingredientId: FLOUR_INGREDIENT_ID,
                quantity: { kind: 'exact', value: quantity },
                unit: 'cup',
            },
        ],
    });

    it('⛔ asks NOTHING when the author OVERRODE our parse — the transcription went stale with it', async () => {
        // ⚠️ NOT the obvious expectation, and the reason is `domain/transcriptionCarryForward.ts`: a line's raw
        // source line is carried across an update only while `[foodLookupId, quantity, unit]` is unchanged,
        // and is DROPPED when it moves. So an author editing `2 cups` to `3 cups` leaves a line with no
        // source text, and `decideVerification` reads that as `skip: 'no-source-text'`.
        //
        // That is the correct outcome rather than a gap: carrying the transcription would have the gate check
        // our parse of `3 cups` against a source that said `2 cups`, and correctly DISAGREE with an edit the
        // author made on purpose — manufacturing the wrong-disagree outcome U11 names as the unacceptable
        // direction, on the one line a human has just told us we got wrong.
        const queue = fakeVerificationQueue();
        const dal = fakeRecipesDal({
            findById: vi.fn().mockResolvedValue(stored()),
            update: vi.fn().mockResolvedValue(aggregate({ quantity: '3', sourceLine: null })),
        });

        await makeService(dal, queue).update(OWNER_PRINCIPAL, RECIPE_ID, updateDto(3), undefined);

        expect(queue.enqueue).not.toHaveBeenCalled();
    });

    it('⛔ asks NOTHING when the lines are unchanged — a title edit must not re-pay for the recipe', async () => {
        // `IngredientLinesDal.replaceForRecipe` deletes and re-inserts EVERY line on EVERY save, and both
        // shipped clients send `ingredients` on every save. Without the already-requested filter this is the
        // dominant call volume in the system, and every call of it is money for a verdict already on record.
        const queue = fakeVerificationQueue();
        const dal = fakeRecipesDal({
            findById: vi.fn().mockResolvedValue(stored()),
            update: vi.fn().mockResolvedValue(aggregate()),
        });

        await makeService(dal, queue).update(OWNER_PRINCIPAL, RECIPE_ID, updateDto(2), undefined);

        expect(queue.enqueue).not.toHaveBeenCalled();
    });

    it('asks nothing for a patch that carries no ingredients at all', async () => {
        const queue = fakeVerificationQueue();
        const dal = fakeRecipesDal({
            findById: vi.fn().mockResolvedValue(stored()),
            update: vi.fn().mockResolvedValue(aggregate()),
        });

        await makeService(dal, queue).update(
            OWNER_PRINCIPAL,
            RECIPE_ID,
            { expectedVersion: 1, title: 'Better bread' },
            undefined,
        );

        expect(queue.enqueue).not.toHaveBeenCalled();
    });
});

/**
 * U22a step 3 — A DROPPED ENQUEUE IS REPORTED, because the swallow is safe for the REQUEST and not for the
 * GUARANTEE.
 *
 * ⛔ Not failing the save is correct and stays: losing these messages degrades to the behaviour that
 * predates the gate, and a bookkeeping failure must not cost a cook their recipe. But it also means the gate
 * silently stopped gating for this recipe, and nothing downstream can distinguish a line nobody verified
 * from a line whose request was dropped — both look like an absent verdict, and absence means publish. The
 * exception is the only evidence of which one happened.
 *
 * ⚠️ Deliberately narrower than "report every catch in this service". The sibling swallow in
 * `erasure.service.ts` is NOT reported, because that one writes a durable row first and a sweeper re-drains
 * it: there is a defined recovery and no residue. What earns an issue here is a durable consequence with no
 * owner, not the severity of the words in the log line.
 */
describe('a verification enqueue that fails is reported, not only logged', () => {
    it('⛔ raises an issue carrying the error, and still lets the save succeed', async () => {
        const queue = fakeVerificationQueue();
        const failure = new Error('AWS.SimpleQueueService.QueueDoesNotExist');

        queue.enqueue.mockRejectedValue(failure);
        mockCaptureException.mockClear();

        await expect(
            makeService(fakeRecipesDal(), queue).create(OWNER_PRINCIPAL, createDto(), undefined),
        ).resolves.toBeDefined();

        expect(mockCaptureException).toHaveBeenCalledWith(failure);
    });

    it('⚠️ raises NO issue when the enqueue succeeds — one per save is how a project becomes ignored', async () => {
        const queue = fakeVerificationQueue();

        mockCaptureException.mockClear();
        await makeService(fakeRecipesDal(), queue).create(OWNER_PRINCIPAL, createDto(), undefined);

        expect(mockCaptureException).not.toHaveBeenCalled();
    });
});
