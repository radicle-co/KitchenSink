/**
 * `ImportAdvanceService` — ONE bounded step of a bulk import, done as the cook (ADR-0072 §2, §3, §7, §8, §9, §10).
 *
 * DESIGN PATTERN: **Process manager** driven by the client. Nothing matches or binds in the background, because food search
 * runs as the caller or not at all (ADR-0071 §1); each `advance` does the next piece of every item's pipeline with the cook's
 * token, and returns the view. The pipeline of an item is `received → parsing → matched → saved`, and a call does four things
 * in this order, each safe to repeat:
 *
 *  1. **PAY** the allowance for the next unpaid items, once per item, under the bulk channel (the repository spends exactly
 *     the units it marks). When the day is spent nothing is paid and the call goes on to the work it can still do; it
 *     answers `200` with the allowance in the view (never a `429`), so the client keeps the progress it paid for.
 *  2. **PARSE**: give each paid item without a job one, created under an id DERIVED from (import, ordinal, generation) so a
 *     retry after a crash finds the same job instead of paying for a second. A REFUSED recipe (no ingredient line or no step,
 *     ADR-0072 §3) is never paid for or parsed: the queries leave it out.
 *  3. **MATCH**: match the finished jobs' foods under ONE deadline (`proposeForJobs`), and copy a complete job's matches into
 *     the import's own rows (the snapshot), because the job lives a day. An expired job is let go (the generation moves) and
 *     replaced without charging the item again.
 *  4. **SAVE** what is ready, once, PUBLISHED, through the same create path every recipe takes, with the provenance the
 *     cook's statement sets (ADR-0023's exception for this route). The item is CLAIMED inside the recipe's own transaction, so
 *     two saves cannot both commit; the loser's recipe rolls back and it counts the item as done.
 *
 * ## The rules that look like accidents
 *
 *  - **Nothing binds without the cook's decision or a confident match** (`bindingOf`), and nothing at all once the AI budget is
 *    spent: a spent budget keeps every line without a cook decision as written. The cook's own pick always wins.
 *  - **One item's trouble never stops the others.** A food outage, a refused visibility, a missing statement or an unexpected
 *    error leaves THAT item where it is (and defers it to the back of the line), and the call goes on. The view says why.
 *  - **The call is bounded** by a deadline strictly inside the client's timeout and by ceilings on each step; what does not fit
 *    waits for the next call.
 *  - **A private save is not even tried when the cook has no slot** (ADR-0073); the authoritative check is the create path's, and
 *    its `PRIVATE_SLOTS_FULL` denial pauses the rest of the private saves in the call.
 *  - **An item that cannot save yet goes to the back of the line** (`deferItem`), so the items behind it are not starved.
 *  - **An item only the cook can unblock is HELD, not deferred**: one that lacks a cuisine, servings or times (ADR-0072 §3
 *    as amended 2026-11-11), and one whose visibility the policy refuses for its label. Looking at it again would re-queue it
 *    forever. `holdItem` records the revision the save read, the candidates leave it out while that revision stands, and the
 *    cook's next decision moves the revision and releases it. Nothing fills the gap: no default cuisine, no "1 serving", no
 *    "0 minutes", no AI pick, and no draft save.
 *  - **A recipe with no ingredient line or no step is REFUSED** when it is written (`importRefusalOf`): it stays `received`,
 *    and the paying, parsing and saving queries all leave it alone in SQL, so no advance ever picks it up again.
 *  - **The save and the item list agree on why an item waits**: both ask `importItemIssueOf`, in its precedence.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { RecipeErrorCode, RecipeVisibility, ABSENT_QUANTITY } from '@kitchensink/recipe-core';

import type { CallerToken } from '../auth/CallerToken.js';
import { actingPrincipalOf, isPremiumPrincipal, type Principal } from '../auth/principal.js';
import { isDeadlineExceededError } from '../common/boundedBy.js';
import { apiErrorCodeOf } from '../common/apiError.js';
import { sha256Hex } from '../common/sha256.js';
import type { FoodRef } from '../database/schema/foodLookupArm.js';
import { IngredientsService } from '../ingredients/ingredients.service.js';
import { canonicalIngredientName, type CanonicalIngredientName } from '../ingredients/domain/ingredientName.js';
import { MAX_INGREDIENT_NAME_LENGTH } from '../ingredients/ingredients.schema.js';
import type { ParseJobMatchesPort } from '../recipes/domain/parseJobMatch.js';
import { quantityFromColumns } from '../recipes/dal/quantityColumns.js';
import type { LineOriginDirective } from '../recipes/domain/bindingOriginCarryForward.js';
import { resolveStatementProvenance } from '../recipes/domain/provenancePolicy.js';
import { foodRefOf } from '../database/schema/foodLookupArm.js';
import type { CreateRecipeDto } from '../recipes/dto/createRecipe.dto.js';
import type { ImportRecipe, ImportView } from '../recipes/import.schema.js';
import type { ParseProposalMatch } from '../recipes/parseJobs.schema.js';
import { importRecipeSchema } from '../recipes/import.schema.js';
import {
    MatchProposalService,
    PARSE_JOB_MATCHES_DAL,
    type JobProposeResult,
} from '../recipes/matchProposal.service.js';
import { ParseJobsService } from '../recipes/parseJobs.service.js';
import { isRecipeDomainError } from '../recipes/recipe.error.js';
import { RecipesService, type ImportedCreate } from '../recipes/recipes.service.js';
import type { ImportHeader, ImportVisibility, RecipeImportsDal } from './dal/recipeImports.dal.js';
import type { ImportItem, RecipeImportItemsDal } from './dal/recipeImportItems.dal.js';
import { isImportItemAlreadyClaimedError, isImportItemChangedError } from './dal/recipeImportItems.errors.js';
import type { ImportLine, RecipeImportLinesDal } from './dal/recipeImportLines.dal.js';
import { bindingOf, type LineBinding } from './domain/importBindingPolicy.js';
import { importDeclaredNameIdsOf, type DeclaredNameSlot } from './domain/importDeclaredName.js';
import { importJobIdOf } from './domain/importJobId.js';
import {
    IMPORT_ADVANCE_LIMITS,
    RECIPE_IMPORT_ITEMS_DAL,
    RECIPE_IMPORT_LINES_DAL,
    RECIPE_IMPORTS_DAL,
} from './import.tokens.js';
import { importItemIssueOf, type ItemIssue } from './domain/importItemIssue.js';
import { itemIssueFactsOf } from './domain/importItemIssueFacts.js';
import type { ImportRefusal } from './domain/importRefusal.js';
import { IMPORT_DEFAULT_PAGE_SIZE, type ImportAdvanceLimits } from './domain/importLimits.js';
import { fileSaveFactsOf, type SaveableFacts } from './domain/importSaveGap.js';
import { isReadyToSave } from './domain/importSaveReadiness.js';
import { statementOfColumns } from './domain/importStatement.js';
import { visibilityFactsOf, type VisibilityFacts } from './domain/importVisibility.js';
import { cookKeyOf, holdOf, type HoldReason, type ImportHold } from './domain/importHold.js';
import { foodRefOfId, lineFactsOf, type SnapshotPick } from './domain/importLineFacts.js';
import { savedVerdictKeysOf } from './domain/savedVerdictKeys.js';
import { snapshotLinesOf } from './domain/snapshotLines.js';
import { ImportLineView } from './importLineView.js';
import { ImportViewBuilder } from './importView.builder.js';
import { PRIVATE_SLOTS, isPrivateSlotsFull, type PrivateSlotsPort } from './privateSlots.port.js';
import { ownedImport } from './importOwnership.js';

/** One call's time budget: the clock time it ends at, for the step ceilings, and the same end as a signal, for reads. */
interface CallDeadline {
    readonly at: number;
    readonly signal: AbortSignal;
}

/** What a save attempt came to. `held`: only the cook can unblock it, so it waits out of the queue until they decide. */
type SaveOutcome = 'saved' | 'waiting' | 'paused' | 'held';

/** What the save does about an issue: wait, pause, or hold the item for this reason (`importHold.ts`). */
type IssueOutcome = 'waiting' | 'paused' | HoldReason;

/**
 * What the save does about each issue that stops an item. A `Record` over the issue union, so a new issue is a compile error
 * here until someone decides it. A hold names WHY (review M1 on #220): `item` for a cause only the cook's decision changes,
 * `visibility` for the label, which the cook's facts decide too. Paused: a slot can free up without a decision.
 */
const SAVE_OUTCOME_OF_ISSUE = {
    waitingForAllowance: 'waiting',
    needsStatement: 'waiting',
    visibilityRefused: 'visibility',
    // A create refusal the save held already, and the view reads it back from the hold; it still applies to this cook.
    saveRefused: 'createRefused',
    needsCuisine: 'item',
    needsServings: 'item',
    needsTimes: 'item',
    // A refused recipe never leaves `received` (a CHECK), so it is never a save candidate. Should one reach the save all the
    // same, nothing the save can do changes it, so it is held rather than looked at again on every advance.
    noIngredients: 'item',
    noSteps: 'item',
    outOfSlots: 'paused',
} as const satisfies Record<ItemIssue, IssueOutcome>;

/**
 * What a create the save path refused comes to, or `undefined` for an error the save does not expect. Pure.
 *
 * `unpublishable` is kept apart because the import judged the recipe publishable first, so that refusal is a defect to log.
 */
function outcomeOfCreateRefusal(error: unknown): 'saved' | 'waiting' | 'createRefused' | 'unpublishable' | undefined {
    if (isImportItemAlreadyClaimedError(error)) {
        // Another call saved it first; this one's recipe rolled back with the failed claim.
        return 'saved';
    }

    if (isImportItemChangedError(error)) {
        // The cook decided something while the recipe was being built: it rolled back, and the next call saves from it.
        return 'waiting';
    }

    // The item-side check predicted an allowed visibility and the create disagreed (a full slot is `PRIVATE_SLOTS_FULL`, which
    // pauses, and a contained publish has its own code). Held with the cook's facts, so a change of plan or containment
    // gives it one more look rather than none.
    if (isRecipeDomainError(error) && error.code === RecipeErrorCode.INVALID_VISIBILITY) {
        return 'createRefused';
    }

    if (isRecipeDomainError(error) && error.code === RecipeErrorCode.PUBLISH_REQUIREMENTS_UNMET) {
        return 'unpublishable';
    }

    return undefined;
}

/** The create body for an imported recipe, PUBLISHED with the visibility the cook chose. Pure. */
function createDtoOf(
    recipe: ImportRecipe,
    facts: SaveableFacts,
    requested: ImportVisibility,
    ingredients: CreateRecipeDto['ingredients'],
): CreateRecipeDto {
    return {
        title: recipe.title,
        ...(recipe.description === undefined ? {} : { description: recipe.description }),
        ...(facts.cuisine === null ? {} : { cuisine: facts.cuisine }),
        ...(recipe.difficulty === undefined ? {} : { difficulty: recipe.difficulty }),
        ...(recipe.mealType === undefined ? {} : { mealType: recipe.mealType }),
        status: 'published',
        visibility: requested === 'public' ? RecipeVisibility.PUBLIC : RecipeVisibility.PRIVATE,
        // The create route requires these and another app's export often states none. Nothing makes one up: an item missing
        // one is held for the cook, so these are the cook's choice or the file's, never a neutral stand-in.
        servings: facts.servings,
        prepTimeMinutes: facts.prepTimeMinutes,
        cookTimeMinutes: facts.cookTimeMinutes,
        totalTimeMinutes: facts.totalTimeMinutes,
        ...(recipe.tags === undefined ? {} : { tags: recipe.tags }),
        ...(recipe.dietaryFlags === undefined ? {} : { dietaryFlags: recipe.dietaryFlags }),
        ingredients,
        steps: recipe.steps.map((step) => ({
            instruction: step.instruction,
            ...(step.timerSeconds === undefined ? {} : { timerSeconds: step.timerSeconds }),
        })),
    };
}

/** The lines of a stored payload, which is all the parse step needs from it. */
const payloadLinesSchema = z.object({ ingredientLines: z.array(z.string()) });

/** The cook's stored pick on a snapshot line, in the shape the line facts read. Pure. */
function pickOfLine(line: ImportLine): SnapshotPick | undefined {
    if (line.pickedAgainstDigest === null) {
        return undefined;
    }

    return {
        ...(line.pickedFoodId === null ? {} : { foodId: line.pickedFoodId }),
        ...(line.pickedFoodVariantId === null ? {} : { foodVariantId: line.pickedFoodVariantId }),
        asWritten: line.pickedAsWritten,
        againstDigest: line.pickedAgainstDigest,
    };
}

/**
 * The name every freeform line falls back to when neither its phrase nor its raw line makes a valid ingredient name.
 *
 * Resolved once at load: `'Ingredient'` is a valid canonical name, so a failure here is a defect in the name rules, and it is
 * better to fail the process at boot than to park every such item at save time.
 */
const FALLBACK_FREEFORM_NAME: CanonicalIngredientName = (() => {
    const name = canonicalIngredientName('Ingredient');

    if (name === undefined) {
        throw new Error('the fallback ingredient name is not a valid canonical name');
    }

    return name;
})();

/** A name for a line kept as written: its phrase, else the raw line, cut to what a declared name may be, else a fixed fallback. Pure. */
function freeformNameOf(phrase: string | undefined, rawLine: string): CanonicalIngredientName {
    const cut = (text: string) => canonicalIngredientName(text.slice(0, MAX_INGREDIENT_NAME_LENGTH));

    return (phrase === undefined ? undefined : cut(phrase)) ?? cut(rawLine) ?? FALLBACK_FREEFORM_NAME;
}

/** A snapshot line with its match and what `bindingOf` decided for it. */
interface DecidedLine {
    readonly line: ImportLine;
    readonly match: ParseProposalMatch;
    readonly binding: LineBinding;
}

/** What admitting a line's food came to: the binding, a line to keep as written, or food could not be asked (the item waits). */
type Admission =
    | { readonly kind: 'bound'; readonly bindingId: string }
    | { readonly kind: 'asWritten' }
    | { readonly kind: 'unavailable' };

/** One line of the recipe being built, with the origin the import states for it. */
interface BuiltLine {
    readonly line: CreateRecipeDto['ingredients'][number];
    readonly origin: LineOriginDirective;
}

@Injectable()
export class ImportAdvanceService {
    private readonly logger = new Logger(ImportAdvanceService.name);

    public constructor(
        @Inject(RECIPE_IMPORTS_DAL) private readonly imports: Pick<RecipeImportsDal, 'findHeader' | 'touch'>,
        @Inject(RECIPE_IMPORT_ITEMS_DAL)
        private readonly items: Pick<
            RecipeImportItemsDal,
            | 'payUnpaid'
            | 'findNeedingJob'
            | 'findParsing'
            | 'findSaveCandidates'
            | 'deferItem'
            | 'holdItem'
            | 'countSaveFailure'
            | 'attachJob'
            | 'detachExpiredJob'
            | 'snapshot'
            | 'claimSave'
        >,
        @Inject(RECIPE_IMPORT_LINES_DAL)
        private readonly lines: Pick<RecipeImportLinesDal, 'findForItem' | 'setSavedKeys'>,
        @Inject(ParseJobsService) private readonly parseJobs: Pick<ParseJobsService, 'createPrepaid' | 'retry'>,
        @Inject(PARSE_JOB_MATCHES_DAL) private readonly matchStore: Pick<ParseJobMatchesPort, 'findForJob'>,
        @Inject(MatchProposalService) private readonly matcher: Pick<MatchProposalService, 'proposeForJobs'>,
        @Inject(ImportLineView) private readonly lineView: Pick<ImportLineView, 'matchesOf'>,
        @Inject(IngredientsService)
        private readonly ingredients: Pick<IngredientsService, 'addByRef' | 'createFreeformOnce'>,
        @Inject(RecipesService) private readonly recipes: Pick<RecipesService, 'create'>,
        @Inject(PRIVATE_SLOTS) private readonly slots: PrivateSlotsPort,
        @Inject(ImportViewBuilder) private readonly builder: Pick<ImportViewBuilder, 'build'>,
        @Inject(IMPORT_ADVANCE_LIMITS) private readonly limits: ImportAdvanceLimits,
    ) {}

    /**
     * Do the next bounded step of the import and answer its view.
     *
     * @param principal - The verified caller.
     * @param caller - The caller's credential, forwarded to food: every match and bind is made as the cook.
     * @param importId - The import.
     * @returns The view, whatever the step did or did not get to (the allowance included).
     * @throws `IMPORT_NOT_FOUND` for a stranger's or an absent import. An unexpected failure of one item does not throw: it is
     *   logged, and the item waits.
     * @sideEffect Moves the import's activity clock, spends allowance units, creates parse jobs and SQS messages, searches food
     *   and binds foods as the cook, writes snapshots and recipes.
     */
    public async advance(principal: Principal, caller: CallerToken | undefined, importId: string): Promise<ImportView> {
        const header = await ownedImport(this.imports, principal, importId);
        const deadlineAt = this.limits.now() + this.limits.deadlineMs;
        // The same budget as a signal, for the reads that can stall (the verdict tables, food): they end with the call.
        const deadline = AbortSignal.timeout(this.limits.deadlineMs);

        // ADR-0072 §9: the working data is purged 30 days after the last advance, so every advance moves the clock, even one
        // that finds nothing to write (every item waiting on the cook's review).
        await this.imports.touch(header.id);

        await this.payAndStartParsing(principal, header, deadlineAt);
        await this.matchParsing(principal, caller, header, { at: deadlineAt, signal: deadline });
        await this.saveReady(principal, caller, header, { at: deadlineAt, signal: deadline });

        return this.builder.build(principal, header, { limit: IMPORT_DEFAULT_PAGE_SIZE });
    }

    // ── 1 and 2: pay, and give each paid item its parse job ─────────────────────────────────────────────────────────

    private async payAndStartParsing(principal: Principal, header: ImportHeader, deadlineAt: number): Promise<void> {
        // The outcome is not needed: the view reads the allowance from the ledger, and a spent day simply pays nothing.
        await this.items.payUnpaid(principal.userId, header.id, {
            limit: this.limits.payBatch,
            isPremium: isPremiumPrincipal(principal),
        });

        for (const item of await this.items.findNeedingJob(header.id, this.limits.payBatch)) {
            if (this.limits.now() >= deadlineAt) {
                return;
            }

            try {
                await this.startParsing(principal, header, item);
            } catch (error) {
                this.logger.error(
                    `import ${header.id} item ${String(item.ordinal)}: starting its parse failed; it is retried`,
                    errorStack(error),
                );
                // To the back of the line: a start that keeps failing must not hold the front of every call.
                await this.items.deferItem(header.id, item.ordinal);
            }
        }
    }

    private async startParsing(principal: Principal, header: ImportHeader, item: ImportItem): Promise<void> {
        // A refused recipe (no ingredient line) never gets here: `findNeedingJob` leaves it out, so there is always a line to parse.
        const payload = payloadLinesSchema.parse(item.payload);

        const jobId = importJobIdOf(header.id, item.ordinal, item.parseGeneration, sha256Hex);

        // The parse copy is trimmed; the recipe keeps the raw line the file stated (see `saveOne`).
        await this.parseJobs.createPrepaid(
            principal.userId,
            payload.ingredientLines.map((line) => line.trim()),
            jobId,
        );
        await this.items.attachJob(header.id, item.ordinal, item.parseGeneration, jobId);
    }

    // ── 3: match the jobs that finished, and take the snapshot ──────────────────────────────────────────────────────

    private async matchParsing(
        principal: Principal,
        caller: CallerToken | undefined,
        header: ImportHeader,
        deadline: CallDeadline,
    ): Promise<void> {
        if (this.limits.now() >= deadline.at) {
            return;
        }

        const parsing = await this.items.findParsing(header.id, this.limits.matchJobs);
        const byJob = new Map(
            parsing.flatMap((item) => (item.parseJobId === null ? [] : [[item.parseJobId, item] as const])),
        );

        if (byJob.size === 0) {
            return;
        }

        let results: readonly JobProposeResult[];

        try {
            results = await this.matcher.proposeForJobs(actingPrincipalOf(principal), caller, [...byJob.keys()], {
                signal: deadline.signal,
            });
        } catch (error) {
            // The call's budget ran out before the matcher read its first job: nothing was matched, and the next call
            // matches them. Any other failure is not this step's to swallow.
            if (isDeadlineExceededError(error)) {
                return;
            }

            throw error;
        }

        for (const result of results) {
            const item = byJob.get(result.jobId);

            if (item === undefined) {
                continue;
            }

            let moved = false;

            try {
                moved = await this.afterMatch(principal, header, item, result);
            } catch (error) {
                this.logger.error(
                    `import ${header.id} item ${String(item.ordinal)}: matching its job failed; it is retried`,
                    errorStack(error),
                );
            }

            // ⛔ A job that has not landed (still running, waiting on a retry, skipped, or failing) goes to the BACK of the line.
            // Without this the same first window of jobs is examined on every call, and one stuck window holds back every item
            // behind it until the jobs expire a day later.
            if (!moved) {
                await this.items.deferItem(header.id, item.ordinal);
            }
        }
    }

    /**
     * What a finished (or failed) lookup of an item's job comes to.
     *
     * @returns Whether the item MOVED: it was snapshotted, or its expired job was let go. `false` leaves it where it is.
     */
    private async afterMatch(
        principal: Principal,
        header: ImportHeader,
        item: ImportItem,
        result: JobProposeResult,
    ): Promise<boolean> {
        if (result.kind === 'skipped') {
            return false;
        }

        if (
            result.kind === 'missing' ||
            result.kind === 'expired' ||
            (result.kind === 'ok' && result.record.status === 'expired')
        ) {
            // The job is gone before the item was matched: let it go. The generation moves, so the replacement is a new job;
            // the item stays paid and is not charged again.
            await this.items.detachExpiredJob(header.id, item.ordinal, item.parseGeneration);

            return true;
        }

        if (result.record.status === 'partial') {
            // Lines that could not be sent wait for a retry; re-drive exactly those, once per call.
            await this.parseJobs.retry(principal.userId, result.jobId);

            return false;
        }

        if (result.record.status !== 'complete' || !result.matchesComplete) {
            return false;
        }

        const matches = await this.matchStore.findForJob(principal.userId, result.jobId);
        const snapshot = snapshotLinesOf(result.record, matches, sha256Hex);

        return snapshot !== undefined && (await this.items.snapshot(header.id, item.ordinal, snapshot));
    }

    // ── 4: save what is ready ───────────────────────────────────────────────────────────────────────────────────────

    private async saveReady(
        principal: Principal,
        caller: CallerToken | undefined,
        header: ImportHeader,
        deadline: CallDeadline,
    ): Promise<void> {
        const candidates = await this.items.findSaveCandidates(
            header.id,
            this.limits.saveExamine,
            cookKeyOf(visibilityFactsOf(principal)),
        );

        if (candidates.length === 0) {
            return;
        }

        let saved = 0;
        // Asked once per call: advisory (the create path decides under the lock). A cook out of slots saves no more private items.
        let privateAllowed = await this.slots.hasAvailable(principal);

        for (const item of candidates) {
            if (saved >= this.limits.saveBatch || this.limits.now() + this.limits.saveMinMs > deadline.at) {
                return;
            }

            let outcome: SaveOutcome;

            try {
                outcome = await this.saveOne(principal, caller, header, item, {
                    privateAllowed,
                    deadline: deadline.signal,
                });
            } catch (error) {
                if (isPrivateSlotsFull(error)) {
                    outcome = 'paused';
                    privateAllowed = false;
                } else {
                    this.logger.error(
                        `import ${header.id} item ${String(item.ordinal)}: saving it failed`,
                        errorStack(error),
                    );
                    outcome = await this.failed(principal, header, item);
                }
            }

            if (outcome === 'saved') {
                saved += 1;
            } else if (outcome !== 'held') {
                await this.items.deferItem(header.id, item.ordinal);
            }
        }
    }

    /**
     * Save one matched item, PUBLISHED, if it is ready and allowed.
     *
     * What stops it is judged by the item list's own Specification (`importItemIssueOf`), in its precedence, so the save and
     * the view cannot disagree about why an item waits. That is decided before the match read, which asks food and the
     * review gate.
     *
     * @returns `saved` (this call or a racing one); `waiting` (not ready, no statement, food could not be asked); `paused`
     *   (no private slot); `held` (only the cook can fix it: a refused visibility, or a missing cuisine, servings or times;
     *   held at the revision read).
     */
    private async saveOne(
        principal: Principal,
        caller: CallerToken | undefined,
        header: ImportHeader,
        item: ImportItem,
        { privateAllowed, deadline }: { readonly privateAllowed: boolean; readonly deadline: AbortSignal },
    ): Promise<SaveOutcome> {
        const requested: ImportVisibility = item.visibility ?? header.visibility;
        const statement = statementOfColumns(item);
        const cook = visibilityFactsOf(principal);
        const recipe = this.storedRecipeOf(header, item);

        if (recipe === undefined) {
            return this.hold(header, item, holdOf('unreadable', cook));
        }

        const { facts, reading } = itemIssueFactsOf({
            item,
            statement,
            requested,
            cook,
            saveFacts: {
                file: fileSaveFactsOf(item.payload),
                ingredientLineCount: recipe.ingredientLines.length,
                stepCount: recipe.steps.length,
            },
            outOfSlots: !privateAllowed,
            // A save candidate is matched, so the allowance (which only a received item reads) does not apply.
            allowanceSpent: false,
        });
        this.noteRefusalAtSave(header, item, facts.refusal);

        const issue = importItemIssueOf(facts);

        if (issue !== null) {
            return this.settle(header, item, cook, SAVE_OUTCOME_OF_ISSUE[issue]);
        }

        // The ONE reading of a statement as provenance, the same one a recipe's own `statement` takes (ADR-0089).
        const provenance = statement === undefined ? undefined : resolveStatementProvenance(statement);

        // ⛔ Unreachable by the issue rule above: a missing statement, an unusable link (a refused visibility) and a save gap
        // each stop the item there. Reaching this is a defect, so it is said once and held where the cook sees it
        // (`saveRefused`), never retried on every advance (ruling (a) on #220).
        if (provenance === undefined || reading === undefined || 'gap' in reading) {
            this.logger.error(
                `import ${header.id} item ${String(item.ordinal)}: the issue rule passed an item that cannot be saved; it is held`,
            );

            return this.hold(header, item, holdOf('createRefused', cook));
        }

        const saveable = reading.saveable;

        const snapshot = await this.lines.findForItem(header.id, item.ordinal);
        const matches = await this.lineView.matchesOf(actingPrincipalOf(principal), caller, snapshot, deadline);
        const lineFacts = snapshot.map((line) => {
            const match = matches.get(line.id);

            return match === null || match === undefined
                ? undefined
                : {
                      line,
                      match,
                      facts: lineFactsOf({ match, pick: pickOfLine(line), judgementDigest: line.judgementDigest }),
                  };
        });

        // A line food could not be asked about is decided later, never on a guess.
        if (lineFacts.some((entry) => entry === undefined)) {
            return 'waiting';
        }

        const known = lineFacts.flatMap((entry) => (entry === undefined ? [] : [entry]));
        const reviewClosed = header.reviewClosedAt !== null;

        if (
            !isReadyToSave({
                mode: header.matchMode,
                itemReview: item.review,
                reviewClosed,
                matchedForMs: item.matchedAt === null ? undefined : this.limits.now() - item.matchedAt.getTime(),
                checkingWaitMs: this.limits.checkingWaitMs,
                lines: known.map((entry) => entry.facts),
            })
        ) {
            return 'waiting';
        }

        const decided = known.map((entry) => ({
            ...entry,
            binding: bindingOf({ mode: header.matchMode, itemReview: item.review, reviewClosed, line: entry.facts }),
        }));
        const built = await this.buildLines(principal, caller, item, recipe, decided, deadline);

        if (built === undefined) {
            return 'waiting';
        }

        const imported: ImportedCreate = {
            provenance,
            lineOrigins: built.origins,
            afterWrite: async (tx, saved) => {
                // ⛔ In the recipe's OWN transaction: the claim and the recipe commit or vanish together.
                await this.items.claimSave(tx, header.id, item.ordinal, saved.recipeId, item.decisionRev);
                await this.lines.setSavedKeys(
                    tx,
                    savedVerdictKeysOf(saved.ingredients, (lookupId) => {
                        const arm = saved.identities.get(lookupId)?.arm;

                        return arm === undefined ? undefined : foodRefOf(arm)?.id;
                    }),
                );
            },
        };

        try {
            await this.recipes.create(
                principal,
                createDtoOf(recipe, saveable, requested, built.lines),
                caller,
                imported,
            );
        } catch (error) {
            const refused = outcomeOfCreateRefusal(error);

            if (refused === undefined) {
                throw error;
            }

            if (refused === 'unpublishable') {
                // The check above asks the same policy over the same facts, so this is a defect: say so, and hold it all the
                // same, because retrying a refusal nothing will change is the loop the hold exists to stop.
                this.logger.error(
                    `import ${header.id} item ${String(item.ordinal)}: the create path refused a recipe the import judged publishable; it is held`,
                    errorStack(error),
                );

                return this.hold(header, item, holdOf('createRefused', cook));
            }

            return this.settle(header, item, cook, refused);
        }

        return 'saved';
    }

    /**
     * After a save that failed for a cause no rule recognises (the caller logged it): retried, until `saveFailureCap`
     * failures in a row at this revision hold it as a create refusal (`saveRefused`), so every failure has an end state. The
     * hold is said ONCE. A count that fails too leaves the item waiting, uncounted, so the advance still answers.
     *
     * @sideEffect Counts the failure; at the cap, writes the hold and logs it; logs a count that failed.
     */
    private async failed(principal: Principal, header: ImportHeader, item: ImportItem): Promise<SaveOutcome> {
        let failures: number | undefined;

        try {
            failures = await this.items.countSaveFailure(header.id, item.ordinal, item.decisionRev);
        } catch (error) {
            this.logger.error(
                `import ${header.id} item ${String(item.ordinal)}: counting the failure failed; it waits`,
                errorStack(error),
            );

            return 'waiting';
        }

        if (failures === undefined || failures < this.limits.saveFailureCap) {
            return 'waiting';
        }

        this.logger.error(
            `import ${header.id} item ${String(item.ordinal)}: saving it failed ${String(failures)} times in a row at this decision; it is held`,
        );

        return this.hold(header, item, holdOf('createRefused', visibilityFactsOf(principal)));
    }

    // ── the save's two defect paths, each said ONCE: the hold that follows takes the item out of the queue ──────────────

    /**
     * The item's stored recipe, or `undefined` for a payload the contract admitted but this build cannot read. Such an item can
     * never be saved: the caller holds it, so no later advance looks at it (or logs it) again until the cook replaces it.
     *
     * @sideEffect Logs the unreadable payload.
     */
    private storedRecipeOf(header: ImportHeader, item: ImportItem): ImportRecipe | undefined {
        const read = importRecipeSchema.safeParse(item.payload);

        if (!read.success) {
            this.logger.error(
                `import ${header.id} item ${String(item.ordinal)}: its stored recipe does not read; it is held`,
                read.error.message,
            );

            return undefined;
        }

        return read.data;
    }

    /**
     * Say that a refused recipe reached the save. The upload refuses such a recipe and a refusal stays `received`, so a
     * matched one is a defect. Its refusal issue holds it right after, so this is said once.
     *
     * @param refusal - The refusal the save derived (`itemIssueFactsOf`).
     * @sideEffect Logs when the save found a refusal the upload did not store.
     */
    private noteRefusalAtSave(header: ImportHeader, item: ImportItem, refusal: ImportRefusal | null): void {
        if (item.refusal === null && refusal !== null) {
            this.logger.error(
                `import ${header.id} item ${String(item.ordinal)}: a ${refusal} recipe reached the save; it is held`,
            );
        }
    }

    /**
     * Apply an outcome: a hold reason writes that hold, judged under this cook; any other is returned as it is.
     *
     * @sideEffect Writes the hold for a hold reason.
     */
    private async settle(
        header: ImportHeader,
        item: ImportItem,
        cook: VisibilityFacts,
        outcome: IssueOutcome | 'saved',
    ): Promise<SaveOutcome> {
        return outcome === 'saved' || outcome === 'waiting' || outcome === 'paused'
            ? outcome
            : this.hold(header, item, holdOf(outcome, cook));
    }

    /**
     * Hold an item at the revision the save read (a decision since then leaves it unheld), with why: a cause the cook's facts
     * decide records them, so other facts bring it back (`importHold.ts`).
     *
     * @sideEffect Writes the hold.
     */
    private async hold(header: ImportHeader, item: ImportItem, hold: ImportHold): Promise<SaveOutcome> {
        await this.items.holdItem(header.id, item.ordinal, item.decisionRev, hold);

        return 'held';
    }

    /**
     * The recipe's lines, in file order, with the foods bound through the by-food admission AS THE COOK and the origin of each.
     *
     * Two passes. Food is asked to admit every chosen food FIRST; its bindings converge (one per food), so asking again
     * on a retry adds nothing. Only once food has answered for every line are the names declared, because a declared name
     * is a new record each time and nothing reaps one that no line points at: a food outage, which repeats on every call
     * until food is back, then leaves nothing behind.
     *
     * @returns The lines and their origins, or `undefined` when food could not be asked to admit a food (the item waits).
     */
    private async buildLines(
        principal: Principal,
        caller: CallerToken | undefined,
        item: ImportItem,
        recipe: ImportRecipe,
        decided: readonly DecidedLine[],
        deadline: AbortSignal,
    ): Promise<
        { readonly lines: CreateRecipeDto['ingredients']; readonly origins: readonly LineOriginDirective[] } | undefined
    > {
        const admissions = new Map<DecidedLine, Exclude<Admission, { kind: 'unavailable' }>>();

        for (const entry of decided) {
            const admission: Admission =
                entry.binding.kind === 'bind'
                    ? await this.admit(principal, caller, entry.match, entry.line, entry.binding.foodId, deadline)
                    : { kind: 'asWritten' };

            if (admission.kind === 'unavailable') {
                return undefined;
            }

            admissions.set(entry, admission);
        }

        const built: BuiltLine[] = [];

        for (const [lineIndex, rawLine] of recipe.ingredientLines.entries()) {
            const foods = decided.filter((entry) => entry.line.lineIndex === lineIndex);

            if (foods.length === 0) {
                // The line parsed to nothing (a heading, an unparseable line, one the cook kept): it is kept whole, as written.
                built.push(await this.keptWhole(item, lineIndex, rawLine));
                continue;
            }

            for (const entry of foods) {
                const admission = admissions.get(entry);

                // Every decided entry was admitted above; a miss is a defect, never a reason to keep a bound food as text.
                if (admission === undefined) {
                    throw new Error(`import line ${entry.line.id}: no admission was recorded for its food`);
                }

                built.push(await this.foodLine(item, rawLine, entry, admission));
            }
        }

        return { lines: built.map(({ line }) => line), origins: built.map(({ origin }) => origin) };
    }

    /**
     * The name a line kept as written is declared under, ONCE per place in the import: the create runs after it and can
     * fail, and a retry must find this record rather than declare another (review item 4 on #220).
     */
    private async declare(
        item: ImportItem,
        slot: Pick<DeclaredNameSlot, 'lineIndex' | 'foodIndex'>,
        name: CanonicalIngredientName,
    ) {
        const ids = importDeclaredNameIdsOf(
            { importId: item.importId, ordinal: item.ordinal, generation: item.parseGeneration, ...slot },
            sha256Hex,
        );

        return this.ingredients.createFreeformOnce(name, ids);
    }

    /** A line that parsed to nothing, kept whole as written, with no origin and no link. */
    private async keptWhole(item: ImportItem, lineIndex: number, rawLine: string): Promise<BuiltLine> {
        const declared = await this.declare(
            item,
            { lineIndex, foodIndex: 'whole' },
            freeformNameOf(undefined, rawLine),
        );

        return {
            line: { ingredientId: declared.id, quantity: ABSENT_QUANTITY, sourceLine: rawLine },
            origin: { kind: 'set', boundBy: null, importLineId: null },
        };
    }

    /** One food of one line: bound when food admitted the chosen food, else kept as written under the phrase. */
    private async foodLine(
        item: ImportItem,
        rawLine: string,
        { line, binding }: DecidedLine,
        admission: Exclude<Admission, { kind: 'unavailable' }>,
    ): Promise<BuiltLine> {
        const ingredientId =
            admission.kind === 'bound'
                ? admission.bindingId
                : (
                      await this.declare(
                          item,
                          { lineIndex: line.lineIndex, foodIndex: line.foodIndex },
                          freeformNameOf(line.name, rawLine),
                      )
                  ).id;

        return {
            line: {
                ingredientId,
                quantity: quantityFromColumns(line),
                ...(line.unit === '' ? {} : { unit: line.unit }),
                ...(line.preparation === null ? {} : { preparation: line.preparation }),
                ...(line.displayText === null ? {} : { displayText: line.displayText }),
                ...(line.note === null ? {} : { note: line.note }),
                sourceLine: rawLine,
                sourcePhrase: line.phrase,
            },
            origin: {
                kind: 'set',
                boundBy: admission.kind === 'bound' && binding.kind === 'bind' ? binding.boundBy : null,
                importLineId: line.id,
            },
        };
    }

    /** Bind a food through the by-food admission, as the cook. */
    private async admit(
        principal: Principal,
        caller: CallerToken | undefined,
        match: ParseProposalMatch,
        line: ImportLine,
        foodId: string,
        deadline: AbortSignal,
    ): Promise<Admission> {
        const ref: FoodRef | undefined = foodRefOfId(match, pickOfLine(line), foodId);

        if (ref === undefined) {
            return { kind: 'asWritten' };
        }

        try {
            return {
                kind: 'bound',
                bindingId: (await this.ingredients.addByRef(caller, ref, principal.userId, { signal: deadline })).id,
            };
        } catch (error) {
            if (isRecipeDomainError(error) && error.code === RecipeErrorCode.UNKNOWN_INGREDIENT) {
                return { kind: 'asWritten' };
            }

            if (apiErrorCodeOf(error) === 'SOURCE_UNAVAILABLE') {
                return { kind: 'unavailable' };
            }

            throw error;
        }
    }
}

/** A thrown value as log text. Pure. */
function errorStack(error: unknown): string {
    return error instanceof Error ? (error.stack ?? error.message) : String(error);
}
