/**
 * `MatchProposalService` (ADR-0071) — matches the foods of a paste job's parsed lines to catalog foods, as PROPOSALS.
 *
 * DESIGN PATTERN: **Application Service** over four ports: the parse job (`ParseJobsDalPort`), the match store
 * (`ParseJobMatchesPort`), the proposal chain (the cascade's Registry, `PROPOSAL_TIERS`) and the verification queue. The
 * judgements it applies are the pure `domain/matchProposal.ts`; this class only orders the I/O around them.
 *
 * ## The rules that live HERE
 *
 *  1. **Resolution runs AS THE COOK** (#120, R20). The chain gets the caller's own credential and user id; the worker
 *     that parses lines has neither, which is why matching lives in this service and not in the worker.
 *  2. **A proposal binds nothing** (R19 as amended by ADR-0071). The reviewed draft still binds through by-food
 *     admission. What is stored is the proposal, its candidates, and the key its verdict will live under.
 *  3. **The lexical shortlist runs for EVERY proposal.** The candidates come from it, and so does the fact that a
 *     default applies to the phrase. A curated or memo answer does not make that fact go away: a default noun is never
 *     shown as confident (coordinator decision 1, `matchState.ts`).
 *  4. **An outage is never stored as "no match".** A tier that could not look, a proposal food could not be asked
 *     about, or a switched-off catalog writes NO row. A stored row for the same digest is never recomputed, so a
 *     transient failure stored would become a permanent fact about the line.
 *  5. **One request per proposal, paid once.** A verdict already on record under the key sends nothing; a row already
 *     sent sends nothing; a send is CLAIMED so two concurrent calls cannot both send it, and a failed send releases
 *     its claim so the next call retries. Identity is always asked (no band, no curated skip).
 *  6. **Contained test principals send nothing** (ADR-0040): their proposals are stored, the review is not asked.
 *  7. **Bounded work.** Lines are matched in waves of {@link MatchProposalLimits.concurrency} until a time budget is
 *     spent. What is left waits for the client's next call, which the idempotency above makes safe.
 *
 * ⚠️ Residual risk, recorded rather than hidden: a message SQS accepted and then lost leaves its row claimed with no
 * verdict, so the line reads `checking` until the job expires. The worker's redelivery and DLQ are the only cover.
 */
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { normalizedIngredientKey } from '@kitchensink/recipe-core/resolution/normalized-key';
import { verificationKey } from '@kitchensink/recipe-core/resolution/verification-key';
import {
    verificationFoodFieldsOf,
    type VerifyIngredientLineMessage,
} from '@kitchensink/recipe-core/resolution/verification-message';

import type { CallerToken } from '../auth/CallerToken.js';
import type { ActingPrincipal } from '../auth/principal.js';
import { isContained, type ContainmentSubject } from '../common/containmentPolicy.js';
import { isBatchEnqueueError } from '../common/batchEnqueueError.js';
import { sha256Hex } from '../common/sha256.js';
import { foodRefKey, type FoodRef } from '../database/schema/foodLookupArm.js';
import type { MatchProposingTier } from '../database/schema/parseJobMatches.js';
import type { FoodRefAnswer } from '../ingredients/domain/foodRefAnswer.js';
import { FoodCatalogGateway } from '../ingredients/foodCatalog.gateway.js';
import { FoodRefsGateway } from '../ingredients/foodRefs.gateway.js';
import {
    runResolutionCascade,
    type CascadeOutcome,
    type RankedCandidate,
    type ResolutionTier,
} from '../ingredients/resolution/resolutionCascade.js';
import { PROPOSAL_TIERS } from '../ingredients/resolution/resolutionRegistry.js';
import type { LineVerificationsDal } from './dal/lineVerifications.dal.js';
import { variantDisplayName } from './domain/lineVerification.js';
import {
    candidatesFor,
    matchJudgementOf,
    proposalVerificationDecision,
    type ParsedLineMeasure,
} from './domain/matchProposal.js';
import type { MatchSlot, NewParseJobMatch, ParseJobMatch, ParseJobMatchesPort } from './domain/parseJobMatch.js';
import {
    PARSE_JOBS_DAL,
    parseJobExpired,
    parseJobNotFound,
    projectProposal,
    type ParseJobRecord,
    type ParseJobsDalPort,
} from './parseJobs.service.js';
import { RECIPE_LINE_VERIFICATIONS_DAL } from './recipes.tokens.js';
import { VERIFICATION_QUEUE, type VerificationQueuePort } from './verification.queue.js';

/** DI token for the match store — provided by `RecipesModule` over the shared Drizzle client. */
export const PARSE_JOB_MATCHES_DAL = 'PARSE_JOB_MATCHES_DAL';

/** DI token for the matcher's work bounds. */
export const MATCH_PROPOSAL_LIMITS = 'MATCH_PROPOSAL_LIMITS';

/** How much work one call may do. */
export interface MatchProposalLimits {
    /** How many (line, food) pairs are matched at once — each costs up to two catalog searches as the cook. */
    readonly concurrency: number;
    /** No new wave starts after this many milliseconds; the rest waits for the next call. */
    readonly budgetMs: number;
}

/**
 * The default bounds. Four at a time keeps a paste's searches within the food client's per-keystroke budget while
 * leaving the request well inside the client's 10 s timeout: four seconds of waves, plus the final wave in flight.
 */
const DEFAULT_LIMITS: MatchProposalLimits = { concurrency: 4, budgetMs: 4_000 };

/** One (line, food) that needs a match: its slot, the line it belongs to, and the food's name. */
interface OwedSlot extends MatchSlot {
    readonly line: ParsedLineMeasure & { readonly lineDigest: string };
    readonly phrase: string;
}

/** A computed match before food has been asked about its proposal. */
type DraftMatch = Omit<NewParseJobMatch, 'verificationKey'>;

/** The slot key a match is held under. Pure. */
const slotKey = (slot: MatchSlot): string => `${String(slot.lineIndex)}:${String(slot.foodIndex)}`;

/** Whether a job's TTL has passed. Pure given its clock. */
function isExpired(job: ParseJobRecord, now: Date): boolean {
    return job.status === 'expired' || job.expiresAt.getTime() <= now.getTime();
}

/** The food a found answer says the ref LIVES at (its forward end), as a ref. Pure. */
function liveEndOf(answer: Extract<FoodRefAnswer, { outcome: 'found' }>): FoodRef {
    return answer.variant === undefined
        ? { kind: 'root', id: answer.rootId }
        : { kind: 'variant', id: answer.variant.id };
}

@Injectable()
export class MatchProposalService {
    private readonly logger = new Logger(MatchProposalService.name);

    public constructor(
        @Inject(PARSE_JOBS_DAL) private readonly jobs: Pick<ParseJobsDalPort, 'getJob'>,
        @Inject(PARSE_JOB_MATCHES_DAL) private readonly matches: ParseJobMatchesPort,
        @Inject(PROPOSAL_TIERS) private readonly tiers: readonly ResolutionTier[],
        @Inject(FoodCatalogGateway) private readonly catalog: Pick<FoodCatalogGateway, 'enabled'>,
        private readonly refs: FoodRefsGateway,
        @Inject(VERIFICATION_QUEUE) private readonly queue: VerificationQueuePort,
        @Inject(RECIPE_LINE_VERIFICATIONS_DAL)
        private readonly verdicts: Pick<LineVerificationsDal, 'findExistingKeys'>,
        @Optional() @Inject(MATCH_PROPOSAL_LIMITS) private readonly limits: MatchProposalLimits = DEFAULT_LIMITS,
    ) {}

    /**
     * Match every parsed food of the owner's job that has no current match, and ask the gate about each proposal.
     *
     * @param acting - The verified caller's acting slice: only their job is read, and their containment decides the enqueue.
     * @param caller - The caller's credential, forwarded to food.
     * @param jobId - The job.
     * @throws `PARSE_JOB_NOT_FOUND` for a stranger or an absent job, `PARSE_JOB_EXPIRED` past the TTL.
     * @sideEffect Food searches and refs reads as the caller, match writes, verification enqueues.
     */
    public async propose(acting: ActingPrincipal, caller: CallerToken | undefined, jobId: string): Promise<void> {
        const ownerId = acting.userId;
        const job = await this.jobs.getJob(ownerId, jobId);

        if (job === undefined) {
            throw parseJobNotFound(jobId);
        }

        if (isExpired(job, new Date())) {
            throw parseJobExpired(jobId);
        }

        if (!this.catalog.enabled) {
            // Rule 4: a switched-off catalog cannot rank, and a no-match stored now would stick.
            this.logger.warn(`parse-job ${jobId}: the catalog blend is switched off; no matches proposed`);

            return;
        }

        const lines = this.parsedLines(job);
        const stored = new Map(
            (await this.matches.findForJob(ownerId, jobId))
                .filter((match) => lines.get(match.lineIndex)?.lineDigest === match.lineDigest)
                .map((match) => [slotKey(match), match] as const),
        );
        const owed = [...lines.values()].flatMap((line) =>
            line.phrases.flatMap((phrase, foodIndex) =>
                stored.has(slotKey({ lineIndex: line.lineIndex, foodIndex }))
                    ? []
                    : [{ lineIndex: line.lineIndex, foodIndex, line, phrase }],
            ),
        );
        const drafts = await this.matchWithinBudget(ownerId, caller, owed);
        const answers = await this.askFoodAbout(
            caller,
            drafts.flatMap((draft) => (draft.proposal === null ? [] : [draft.proposal.food])),
        );
        const fresh = drafts.flatMap((draft) => this.withLiveProposal(draft, lines, answers));
        // A stored proposal is the LIVE end of what the chain named, so the message lookup is by that end too.
        const known = new Map(answers);

        for (const answer of answers.values()) {
            if (answer.outcome === 'found') {
                known.set(foodRefKey(liveEndOf(answer)), answer);
            }
        }

        await this.matches.saveMatches(jobId, fresh);
        await this.sendOwed(acting, caller, jobId, lines, known);
    }

    /**
     * The job's parsed lines that carry a proposal, by index, with the parse's measure and food names.
     *
     * @throws On a stored proposal this build cannot read — the writer is our own worker, so that is a defect.
     */
    private parsedLines(
        job: ParseJobRecord,
    ): ReadonlyMap<number, ParsedLineMeasure & { lineIndex: number; lineDigest: string; phrases: readonly string[] }> {
        const parsed = new Map<
            number,
            ParsedLineMeasure & { lineIndex: number; lineDigest: string; phrases: readonly string[] }
        >();

        for (const line of job.lines) {
            if (line.status !== 'parsed' || line.proposal === null) {
                continue;
            }

            const proposal = projectProposal(line.proposal);

            parsed.set(line.lineIndex, {
                lineIndex: line.lineIndex,
                lineDigest: line.lineDigest,
                sourceLine: line.sourceLine,
                quantity: proposal.quantity,
                unit: proposal.unit,
                statedMeasure: proposal.statedMeasure,
                phrases: proposal.foods.map((food) => food.name),
            });
        }

        return parsed;
    }

    /**
     * Match the owed slots in waves until the budget is spent (rule 7).
     *
     * @returns A draft per slot the chain could answer for; a slot it could not look for is left out (rule 4).
     * @sideEffect Runs the proposal chain as the caller.
     */
    private async matchWithinBudget(
        ownerId: string,
        caller: CallerToken | undefined,
        owed: readonly OwedSlot[],
    ): Promise<readonly DraftMatch[]> {
        const deadline = Date.now() + this.limits.budgetMs;
        const drafts: DraftMatch[] = [];
        const width = Math.max(1, this.limits.concurrency);

        for (let start = 0; start < owed.length; start += width) {
            if (Date.now() >= deadline) {
                break;
            }

            const wave = await Promise.all(
                owed.slice(start, start + width).map((slot) => this.matchOne(ownerId, caller, slot)),
            );

            drafts.push(...wave.filter((draft): draft is DraftMatch => draft !== undefined));
        }

        return drafts;
    }

    /**
     * Run the proposal chain for one food, and the lexical shortlist beside it (rule 3).
     *
     * @returns The draft, or `undefined` when any tier could not look (rule 4). @sideEffect Runs tiers as the caller.
     */
    private async matchOne(
        ownerId: string,
        caller: CallerToken | undefined,
        slot: OwedSlot,
    ): Promise<DraftMatch | undefined> {
        const base = { lineIndex: slot.lineIndex, foodIndex: slot.foodIndex, lineDigest: slot.line.lineDigest };
        const key = normalizedIngredientKey(slot.phrase);

        if (key === undefined) {
            // A name with nothing to key on is a deterministic no-match, not an outage.
            return { ...base, proposal: null, candidates: [] };
        }

        const query = { key, phrase: slot.phrase };
        const context = { userId: ownerId, caller };
        const outcome = await runResolutionCascade(this.tiers, query, context, {
            onTierFailure: (tier, error) =>
                this.logger.warn(
                    `Proposal tier '${tier}' failed for a paste line; the line is matched on a later call.`,
                    error instanceof Error ? error.stack : String(error),
                ),
        });

        if (outcome.unavailable.length > 0) {
            return undefined;
        }

        const ranked = await this.shortlistBeside(outcome, query, context);

        if (ranked === undefined) {
            return undefined;
        }

        const food = outcome.kind === 'resolved' ? outcome.food : undefined;

        return {
            ...base,
            proposal:
                outcome.kind === 'resolved' && food !== undefined
                    ? {
                          // The proposal registry holds exactly the three proposing tiers.
                          matchedBy: outcome.tier as MatchProposingTier,
                          food,
                          rung: outcome.rung ?? null,
                          margin: outcome.confidence ?? null,
                      }
                    : null,
            candidates: candidatesFor(food, ranked),
        };
    }

    /**
     * The lexical shortlist for a phrase: the winning outcome's own when the lexical tier answered or passed, else one
     * lexical run beside a curated or memo answer.
     *
     * @returns The ranked candidates, or `undefined` when the catalog could not be searched.
     * @sideEffect At most one lexical tier run.
     */
    private async shortlistBeside(
        outcome: CascadeOutcome,
        query: Parameters<ResolutionTier['resolve']>[0],
        context: Parameters<ResolutionTier['resolve']>[1],
    ): Promise<readonly RankedCandidate[] | undefined> {
        if (outcome.kind === 'resolved' && outcome.tier === 'lexical') {
            return outcome.candidates ?? [];
        }

        if (outcome.kind === 'exhausted') {
            // The lexical tier ran and passed: it found nothing to rank.
            return [];
        }

        const lexical = this.tiers.find((tier) => tier.id === 'lexical');

        if (lexical === undefined) {
            return [];
        }

        try {
            const ranked = await lexical.resolve(query, context);

            return ranked.kind === 'resolved' ? (ranked.candidates ?? []) : [];
        } catch (error) {
            this.logger.warn(
                'The lexical shortlist could not be read beside a settled proposal; the line is matched later.',
                error instanceof Error ? error.stack : String(error),
            );

            return undefined;
        }
    }

    /**
     * Ask food about these refs, as the caller, in one batched read.
     *
     * @sideEffect One batched refs read.
     */
    private async askFoodAbout(
        caller: CallerToken | undefined,
        refs: readonly FoodRef[],
    ): Promise<ReadonlyMap<string, FoodRefAnswer>> {
        if (refs.length === 0) {
            return new Map();
        }

        return (await this.refs.resolve(caller, refs, 'postCommit')).answers;
    }

    /**
     * Finish a draft with what food said about its proposal: moved to its live end and keyed, dropped when food no
     * longer shows it, or not stored at all when food could not be asked (rule 4).
     *
     * @returns Zero or one match. Pure given the answers.
     */
    private withLiveProposal(
        draft: DraftMatch,
        lines: ReturnType<MatchProposalService['parsedLines']>,
        answers: ReadonlyMap<string, FoodRefAnswer>,
    ): readonly NewParseJobMatch[] {
        const line = lines.get(draft.lineIndex);

        if (draft.proposal === null || line === undefined) {
            return [{ ...draft, verificationKey: null }];
        }

        const answer = answers.get(foodRefKey(draft.proposal.food)) ?? { outcome: 'unreachable' };

        if (answer.outcome === 'unreachable') {
            return [];
        }

        if (answer.outcome === 'absent') {
            const gone = draft.proposal.food;

            return [
                {
                    ...draft,
                    proposal: null,
                    candidates: draft.candidates.filter(
                        (candidate) => candidate.kind !== gone.kind || candidate.id !== gone.id,
                    ),
                    verificationKey: null,
                },
            ];
        }

        const food = liveEndOf(answer);
        const judgement = matchJudgementOf(line, draft.foodIndex, food.id);
        const askable = proposalVerificationDecision(line.sourceLine, food.kind).kind === 'verify';

        return [
            {
                ...draft,
                proposal: { ...draft.proposal, food },
                verificationKey: askable && judgement !== undefined ? verificationKey(judgement, sha256Hex) : null,
            },
        ];
    }

    /**
     * Send one verification request for every current match that is owed one (rule 5).
     *
     * ⛔ NOTHING for a CONTAINED test principal (ADR-0040), and that check is the FIRST statement. The review spends
     * ADR-0024's shared production pool, which a test principal is contained from, exactly as the save path's
     * producer is (`RecipesService.requestVerification`). The proposals stay the cook's own rows; they read `checking`.
     *
     * @sideEffect Reads the matches and the verdict table, claims, enqueues, and releases on failure.
     */
    private async sendOwed(
        subject: ContainmentSubject & Pick<ActingPrincipal, 'userId'>,
        caller: CallerToken | undefined,
        jobId: string,
        lines: ReturnType<MatchProposalService['parsedLines']>,
        known: ReadonlyMap<string, FoodRefAnswer>,
    ): Promise<void> {
        if (isContained(subject)) {
            return;
        }

        const owed = (await this.matches.findForJob(subject.userId, jobId)).filter(
            (match) =>
                match.verificationKey !== null &&
                match.enqueuedAt === null &&
                match.proposal !== null &&
                lines.get(match.lineIndex)?.lineDigest === match.lineDigest,
        );

        if (owed.length === 0) {
            return;
        }

        const unjudged = await this.withoutVerdicts(jobId, owed);
        const unasked = unjudged
            .flatMap((match) => (match.proposal === null ? [] : [match.proposal.food]))
            .filter((ref) => !known.has(foodRefKey(ref)));
        const answers = new Map([...known, ...(await this.askFoodAbout(caller, unasked))]);
        const messages = new Map<string, VerifyIngredientLineMessage>();

        for (const match of unjudged) {
            const message = this.messageFor(jobId, match, lines, answers);

            if (message !== undefined) {
                messages.set(slotKey(match), message);
            }
        }

        const won = await this.matches.claimEnqueue(
            jobId,
            unjudged.filter((match) => messages.has(slotKey(match))),
        );
        const toSend = won.flatMap((slot) => {
            const message = messages.get(slotKey(slot));

            return message === undefined ? [] : [{ slot, message }];
        });

        if (toSend.length === 0) {
            return;
        }

        try {
            await this.queue.enqueue(toSend.map(({ message }) => message));
        } catch (error) {
            const lost = isBatchEnqueueError(error)
                ? error.undeliveredIndexes.flatMap((index) => {
                      const sent = toSend[index];

                      return sent === undefined ? [] : [sent.slot];
                  })
                : toSend.map(({ slot }) => slot);

            this.logger.warn(
                `parse-job ${jobId}: verification enqueue failed for ${String(lost.length)} of ` +
                    `${String(toSend.length)} proposal(s); their claims are released for the next call`,
                error instanceof Error ? error.stack : String(error),
            );
            await this.matches.releaseEnqueue(jobId, lost);
        }
    }

    /**
     * Drop the matches whose verdict is already on record. Fails OPEN: an unreadable verdict table asks about all.
     *
     * @sideEffect One keyed verdict read.
     */
    private async withoutVerdicts(jobId: string, owed: readonly ParseJobMatch[]): Promise<readonly ParseJobMatch[]> {
        try {
            const onRecord = await this.verdicts.findExistingKeys(
                owed.flatMap((match) => (match.verificationKey === null ? [] : [match.verificationKey])),
            );

            return owed.filter((match) => match.verificationKey === null || !onRecord.has(match.verificationKey));
        } catch (error) {
            this.logger.warn(
                `parse-job ${jobId}: verdict dedup read failed; asking about all ${String(owed.length)} proposal(s)`,
                error instanceof Error ? error.stack : String(error),
            );

            return owed;
        }
    }

    /**
     * The verification request for one match, or `undefined` when food cannot name its proposal now.
     *
     * ⛔ The judgement fields come from the SAME derivation the key was stored with, and no `ingredientPhrase` is sent:
     * the worker writes no memo for a paste origin, and a memo of a default would bind it for the next cook.
     *
     * Pure given its inputs.
     */
    private messageFor(
        jobId: string,
        match: ParseJobMatch,
        lines: ReturnType<MatchProposalService['parsedLines']>,
        answers: ReadonlyMap<string, FoodRefAnswer>,
    ): VerifyIngredientLineMessage | undefined {
        const line = lines.get(match.lineIndex);
        const food = match.proposal?.food;
        const answer = food === undefined ? undefined : answers.get(foodRefKey(food));

        if (line === undefined || food === undefined || answer?.outcome !== 'found' || answer.name === undefined) {
            return undefined;
        }

        const judgement = matchJudgementOf(line, match.foodIndex, food.id);

        if (judgement === undefined) {
            return undefined;
        }

        return {
            origin: { kind: 'parseJob', jobId, lineIndex: match.lineIndex, foodIndex: match.foodIndex },
            sourceLine: line.sourceLine,
            ...verificationFoodFieldsOf(food),
            candidateFoodName: variantDisplayName(answer.name, answer.variant?.parts),
            quantityLow: judgement.quantityLow,
            quantityHigh: judgement.quantityHigh,
            unit: judgement.unit,
            evidenceKind: 'unattributed',
            shortlist: [],
            requestedAt: new Date().toISOString(),
            ...(answer.isPrivate ? { privateFood: true } : {}),
        };
    }
}
