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
 *     retry after a crash finds the same job instead of paying for a second. No ingredient lines means nothing to parse and no
 *     charge.
 *  3. **MATCH**: match the finished jobs' foods under ONE deadline (`proposeForJobs`), and copy a complete job's matches into
 *     the import's own rows (the snapshot), because the job lives a day. An expired job is let go (the generation moves) and
 *     replaced without charging the item again.
 *  4. **SAVE** what is ready, once, as a DRAFT through the same create path every recipe takes, with the provenance the cook's
 *     statement sets (ADR-0023's exception for this route). The item is CLAIMED inside the recipe's own transaction, so two
 *     saves cannot both commit; the loser's recipe rolls back and it counts the item as done.
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
 */
import { HttpException } from '@nestjs/common';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { RecipeErrorCode, RecipeVisibility, ABSENT_QUANTITY } from '@kitchensink/recipe-core';

import type { CallerToken } from '../auth/CallerToken.js';
import { actingPrincipalOf, isPremiumPrincipal, type Principal } from '../auth/principal.js';
import { sha256Hex } from '../common/sha256.js';
import type { FoodRef } from '../database/schema/foodLookupArm.js';
import { IngredientsService } from '../ingredients/ingredients.service.js';
import { canonicalIngredientName, type CanonicalIngredientName } from '../ingredients/domain/ingredientName.js';
import { MAX_INGREDIENT_NAME_LENGTH } from '../ingredients/ingredients.schema.js';
import type { ParseJobMatchesPort } from '../recipes/domain/parseJobMatch.js';
import { quantityFromColumns } from '../recipes/dal/quantityColumns.js';
import type { LineOriginDirective } from '../recipes/domain/bindingOriginCarryForward.js';
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
import { importJobIdOf } from './domain/importJobId.js';
import {
    IMPORT_ADVANCE_LIMITS,
    RECIPE_IMPORT_ITEMS_DAL,
    RECIPE_IMPORT_LINES_DAL,
    RECIPE_IMPORTS_DAL,
} from './import.tokens.js';
import { IMPORT_DEFAULT_PAGE_SIZE, type ImportAdvanceLimits } from './domain/importLimits.js';
import { isReadyToSave } from './domain/importSaveReadiness.js';
import { provenanceOfStatement, statementOfColumns } from './domain/importStatement.js';
import { visibilityRefusedFor } from './domain/importVisibility.js';
import { foodRefOfId, lineFactsOf, type SnapshotPick } from './domain/importLineFacts.js';
import { savedVerdictKeysOf } from './domain/savedVerdictKeys.js';
import { savedNameOf, snapshotLinesOf } from './domain/snapshotLines.js';
import { ImportLineView } from './importLineView.js';
import { ImportViewBuilder } from './importView.builder.js';
import { PRIVATE_SLOTS, isPrivateSlotsFull, type PrivateSlotsPort } from './privateSlots.port.js';
import { ownedImport } from './importOwnership.js';

/** What a save attempt came to. */
type SaveOutcome = 'saved' | 'waiting' | 'paused';

/** The lines of a stored payload, which is all the parse step needs from it. */
const payloadLinesSchema = z.object({ ingredientLines: z.array(z.string()) });

/** The code a thrown `HttpException` carries in its body, if any. Pure. */
function httpCodeOf(error: unknown): string | undefined {
    if (!(error instanceof HttpException)) {
        return undefined;
    }

    const body = error.getResponse();

    return typeof body === 'object' && 'code' in body ? String(body.code) : undefined;
}

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
        @Inject(RECIPE_IMPORTS_DAL) private readonly imports: Pick<RecipeImportsDal, 'findHeader'>,
        @Inject(RECIPE_IMPORT_ITEMS_DAL)
        private readonly items: Pick<
            RecipeImportItemsDal,
            | 'payUnpaid'
            | 'findNeedingJob'
            | 'findParsing'
            | 'findSaveCandidates'
            | 'deferItem'
            | 'attachJob'
            | 'detachExpiredJob'
            | 'markMatchedWithoutLines'
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
        private readonly ingredients: Pick<IngredientsService, 'addByRef' | 'createFreeform'>,
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
     * @sideEffect Spends allowance units, creates parse jobs and SQS messages, searches food and binds foods as the cook,
     *   writes snapshots and recipes.
     */
    public async advance(principal: Principal, caller: CallerToken | undefined, importId: string): Promise<ImportView> {
        const header = await ownedImport(this.imports, principal, importId);
        const deadlineAt = this.limits.now() + this.limits.deadlineMs;

        await this.payAndStartParsing(principal, header, deadlineAt);
        await this.matchParsing(principal, caller, header, deadlineAt);
        await this.saveReady(principal, caller, header, deadlineAt);

        return this.builder.build(principal, header, { limit: IMPORT_DEFAULT_PAGE_SIZE });
    }

    // ── 1 and 2: pay, and give each paid item its parse job ─────────────────────────────────────────────────────────

    private async payAndStartParsing(principal: Principal, header: ImportHeader, deadlineAt: number): Promise<void> {
        // The outcome is not needed: the view reads the allowance from the ledger, and a spent day simply pays nothing.
        await this.items.payUnpaid(principal.userId, header.id, { limit: this.limits.payBatch });

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
        const payload = payloadLinesSchema.parse(item.payload);

        if (payload.ingredientLines.length === 0) {
            // Nothing is sent for parsing, so no LLM spend starts and nothing is charged.
            await this.items.markMatchedWithoutLines(header.id, item.ordinal);

            return;
        }

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
        deadlineAt: number,
    ): Promise<void> {
        if (this.limits.now() >= deadlineAt) {
            return;
        }

        const parsing = await this.items.findParsing(header.id, this.limits.matchJobs);
        const byJob = new Map(
            parsing.flatMap((item) => (item.parseJobId === null ? [] : [[item.parseJobId, item] as const])),
        );

        if (byJob.size === 0) {
            return;
        }

        const results = await this.matcher.proposeForJobs(actingPrincipalOf(principal), caller, [...byJob.keys()]);

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
        deadlineAt: number,
    ): Promise<void> {
        const candidates = await this.items.findSaveCandidates(header.id, this.limits.saveExamine);

        if (candidates.length === 0) {
            return;
        }

        let saved = 0;
        // Asked once per call: advisory (the create path decides under the lock). A cook out of slots saves no more private items.
        let privateAllowed = await this.slots.hasAvailable(principal.userId);

        for (const item of candidates) {
            if (saved >= this.limits.saveBatch || this.limits.now() + this.limits.saveMinMs > deadlineAt) {
                return;
            }

            const requested: ImportVisibility = item.visibility ?? header.visibility;
            let outcome: SaveOutcome = 'waiting';

            if (requested === 'private' && !privateAllowed) {
                outcome = 'paused';
            } else {
                try {
                    outcome = await this.saveOne(principal, caller, header, item, requested);
                } catch (error) {
                    if (isPrivateSlotsFull(error)) {
                        outcome = 'paused';
                        privateAllowed = false;
                    } else {
                        this.logger.error(
                            `import ${header.id} item ${String(item.ordinal)}: saving it failed; it is retried`,
                            errorStack(error),
                        );
                    }
                }
            }

            if (outcome === 'saved') {
                saved += 1;
            } else {
                await this.items.deferItem(header.id, item.ordinal);
            }
        }
    }

    /**
     * Save one matched item as a draft, if it is ready and allowed.
     *
     * @returns `saved` (this call or a racing one); `waiting` (not ready, no statement, visibility refused, food could not be
     *   asked); `paused` (no private slot).
     */
    private async saveOne(
        principal: Principal,
        caller: CallerToken | undefined,
        header: ImportHeader,
        item: ImportItem,
        requested: ImportVisibility,
    ): Promise<SaveOutcome> {
        const statement = statementOfColumns(item);

        if (
            statement === undefined ||
            visibilityRefusedFor(
                {
                    principalKind: principal.principalKind,
                    containment: principal.containment,
                    isPremium: isPremiumPrincipal(principal),
                },
                statement,
                requested,
            )
        ) {
            return 'waiting';
        }

        const snapshot = await this.lines.findForItem(header.id, item.ordinal);
        const matches = await this.lineView.matchesOf(actingPrincipalOf(principal), caller, snapshot);
        const facts = snapshot.map((line) => {
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
        if (facts.some((entry) => entry === undefined)) {
            return 'waiting';
        }

        const known = facts.flatMap((entry) => (entry === undefined ? [] : [entry]));
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

        const recipe = importRecipeSchema.parse(item.payload);
        const decided = known.map((entry) => ({
            ...entry,
            binding: bindingOf({ mode: header.matchMode, itemReview: item.review, reviewClosed, line: entry.facts }),
        }));
        const built = await this.buildLines(principal, caller, recipe, decided);

        if (built === undefined) {
            return 'waiting';
        }

        const dto: CreateRecipeDto = {
            title: recipe.title,
            ...(recipe.description === undefined ? {} : { description: recipe.description }),
            ...(recipe.cuisine === undefined ? {} : { cuisine: recipe.cuisine }),
            ...(recipe.difficulty === undefined ? {} : { difficulty: recipe.difficulty }),
            ...(recipe.mealType === undefined ? {} : { mealType: recipe.mealType }),
            status: 'draft',
            visibility: requested === 'public' ? RecipeVisibility.PUBLIC : RecipeVisibility.PRIVATE,
            // The file may state none of these (another app's export often does not); a draft is filled, never refused.
            servings: recipe.servings ?? 1,
            prepTimeMinutes: recipe.prepTimeMinutes ?? 0,
            cookTimeMinutes: recipe.cookTimeMinutes ?? 0,
            totalTimeMinutes: recipe.totalTimeMinutes ?? (recipe.prepTimeMinutes ?? 0) + (recipe.cookTimeMinutes ?? 0),
            ...(recipe.tags === undefined ? {} : { tags: recipe.tags }),
            ...(recipe.dietaryFlags === undefined ? {} : { dietaryFlags: recipe.dietaryFlags }),
            ingredients: built.lines,
            steps: recipe.steps.map((step) => ({
                instruction: step.instruction,
                ...(step.timerSeconds === undefined ? {} : { timerSeconds: step.timerSeconds }),
            })),
        };
        const imported: ImportedCreate = {
            provenance: provenanceOfStatement(statement),
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
            await this.recipes.create(principal, dto, caller, imported);
        } catch (error) {
            if (isImportItemAlreadyClaimedError(error)) {
                // Another call saved it first; this one's recipe rolled back with the failed claim.
                return 'saved';
            }

            if (isImportItemChangedError(error)) {
                // The cook decided something while the recipe was being built: it rolled back, and the next call saves from it.
                return 'waiting';
            }

            if (isRecipeDomainError(error) && error.code === RecipeErrorCode.INVALID_VISIBILITY) {
                return 'waiting';
            }

            throw error;
        }

        return 'saved';
    }

    /**
     * The recipe's lines, in file order, with the foods bound through the by-food admission AS THE COOK and the origin of each.
     *
     * @returns The lines and their origins, or `undefined` when food could not be asked to admit a food (the item waits).
     */
    private async buildLines(
        principal: Principal,
        caller: CallerToken | undefined,
        recipe: ImportRecipe,
        decided: readonly DecidedLine[],
    ): Promise<
        { readonly lines: CreateRecipeDto['ingredients']; readonly origins: readonly LineOriginDirective[] } | undefined
    > {
        const built: BuiltLine[] = [];

        for (const [lineIndex, rawLine] of recipe.ingredientLines.entries()) {
            const foods = decided.filter((entry) => entry.line.lineIndex === lineIndex);

            if (foods.length === 0) {
                // The line parsed to nothing (a heading, an unparseable line, one the cook kept): it is kept whole, as written.
                built.push(await this.keptWhole(rawLine));
                continue;
            }

            for (const entry of foods) {
                const food = await this.foodLine(principal, caller, rawLine, entry);

                if (food === undefined) {
                    return undefined;
                }

                built.push(food);
            }
        }

        return { lines: built.map(({ line }) => line), origins: built.map(({ origin }) => origin) };
    }

    /** A line that parsed to nothing, kept whole as written, with no origin and no link. */
    private async keptWhole(rawLine: string): Promise<BuiltLine> {
        const declared = await this.ingredients.createFreeform(freeformNameOf(undefined, rawLine));

        return {
            line: { ingredientId: declared.id, quantity: ABSENT_QUANTITY, sourceLine: rawLine },
            origin: { kind: 'set', boundBy: null, importLineId: null },
        };
    }

    /**
     * One food of one line: bound when `bindingOf` chose a food that food will admit, else kept as written under the phrase.
     *
     * @returns The line, or `undefined` when food could not be asked (the item waits).
     */
    private async foodLine(
        principal: Principal,
        caller: CallerToken | undefined,
        rawLine: string,
        { line, match, binding }: DecidedLine,
    ): Promise<BuiltLine | undefined> {
        const admission: Admission =
            binding.kind === 'bind'
                ? await this.admit(principal, caller, match, line, binding.foodId)
                : { kind: 'asWritten' };

        if (admission.kind === 'unavailable') {
            return undefined;
        }

        const ingredientId =
            admission.kind === 'bound'
                ? admission.bindingId
                : (await this.ingredients.createFreeform(freeformNameOf(savedNameOf(line), rawLine))).id;

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
    ): Promise<Admission> {
        const ref: FoodRef | undefined = foodRefOfId(match, pickOfLine(line), foodId);

        if (ref === undefined) {
            return { kind: 'asWritten' };
        }

        try {
            return { kind: 'bound', bindingId: (await this.ingredients.addByRef(caller, ref, principal.userId)).id };
        } catch (error) {
            if (isRecipeDomainError(error) && error.code === RecipeErrorCode.UNKNOWN_INGREDIENT) {
                return { kind: 'asWritten' };
            }

            if (httpCodeOf(error) === 'SOURCE_UNAVAILABLE') {
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
