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
 *     about, or a switched-off catalog writes NO row. A current row is never recomputed, so a transient failure stored
 *     would become a permanent fact about the line.
 *  5. **One request per proposal, paid once.** A verdict already on record under the key sends nothing; a row already
 *     sent sends nothing; a send is CLAIMED, as a LEASE, so two concurrent calls cannot both send it, and a failed send
 *     releases only its own claim so the next call retries. A claim older than the queue's delivery bound that left no
 *     verdict and no attempt behind was lost, and is taken again. Identity is always asked (no band, no curated skip).
 *  6. **A row is current only while the line and its parse still give it** (`isCurrentMatch`): the line's stored digest,
 *     and the judgement digest of the current parse for that food. An edited line, or the same text reparsed into
 *     another food or measure, is matched afresh.
 *  7. **A request the gate can never take is REFUSED, and that is persisted.** An over-cap line, or a request the
 *     queue's contract refuses (logged at error), is stored as `refused` and never claimed, so it is not retried on
 *     every poll and the job view reads the refusal rather than re-running the policy.
 *  8. **Contained test principals send nothing** (ADR-0040): their proposals are stored, the review is not asked.
 *  9. **Bounded work, under ONE request deadline** ({@link MATCH_PROPOSE_DEADLINE_MS}). Lines are matched in waves of
 *     {@link MatchProposalLimits.concurrency}; a wave starts only when its catalog searches can finish before the tail
 *     kept for the refs read and the send, and both of those carry the deadline as an abort signal. What is left
 *     waits for the client's next call, which the idempotency above makes safe. Food is asked about every proposal in
 *     ONE batched read, before anything is stored.
 *
 * ⚠️ Residual risk, recorded rather than hidden: a message SQS accepted and then lost leaves its row claimed with no
 * verdict. The line reads `checking` until a matches call arrives after the queue's delivery bound (about nine hours),
 * which re-claims and re-sends it; with no such call it reads `checking` until the job expires.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { parseStoredLineDigest, type LineDigest } from '@kitchensink/recipe-core/parsing/parse-key';
import { normalizedIngredientKey } from '@kitchensink/recipe-core/resolution/normalized-key';
import { verificationDeliveryBoundSeconds } from '@kitchensink/recipe-core/resolution/verification-delivery';
import {
    verifyIngredientLineMessageSchema,
    type VerifyIngredientLineMessage,
} from '@kitchensink/recipe-core/resolution/verification-message';

import type { CallerToken } from '../auth/CallerToken.js';
import type { ActingPrincipal } from '../auth/principal.js';
import { isContained, type ContainmentSubject } from '../common/containmentPolicy.js';
import { isBatchEnqueueError } from '../common/batchEnqueueError.js';
import { sha256Hex } from '../common/sha256.js';
import { foodRefKey, type FoodRef } from '../database/schema/foodLookupArm.js';
import { isMatchProposingTier } from '../database/schema/parseJobMatches.js';
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
import {
    candidatesFor,
    matchJudgementDigestOf,
    proposalKeyOf,
    proposalMessageOf,
    proposalVerificationDecision,
    rankTierOf,
    type ParsedLineMeasure,
} from './domain/matchProposal.js';
import {
    isCurrentMatch,
    slotKey,
    type MatchReview,
    type MatchSlot,
    type NewParseJobMatch,
    type ParseJobMatch,
    type ParseJobMatchesPort,
} from './domain/parseJobMatch.js';
import {
    PARSE_JOBS_DAL,
    parseJobExpired,
    parseJobNotFound,
    projectProposal,
    type ParseJobRecord,
    type ParseJobsDalPort,
} from './parseJobs.service.js';
import { isParseJobExpired } from './domain/parseJobExpiry.js';
import { RECIPE_LINE_VERIFICATIONS_DAL } from './recipes.tokens.js';
import { withoutVerdictsOnRecord } from './verdictDedup.js';
import { VERIFICATION_QUEUE, type VerificationQueuePort } from './verification.queue.js';

/** DI token for the match store — provided by `RecipesModule` over the shared Drizzle client. */
export const PARSE_JOB_MATCHES_DAL = 'PARSE_JOB_MATCHES_DAL';

/** DI token for the matcher's work bounds. */
export const MATCH_PROPOSAL_LIMITS = 'MATCH_PROPOSAL_LIMITS';

/**
 * The deadline `propose` keeps, from its first statement. The same response then reads the job view's names
 * (`ParseJobMatchView`, under the read deadline, at most `MAX_READ_NUTRITION_DEADLINE_MS`), so this plus that ceiling
 * must leave margin inside the recipe client's 10 s timeout. `parseJobMatchesBudget.test.ts` asserts the sum against the
 * client's own constant.
 */
export const MATCH_PROPOSE_DEADLINE_MS = 4_500;

/** The catalog searches one food can cost at most: the lexical pass and its one synonym reformulation. */
const SEARCHES_PER_FOOD = 2;

/** How much work one call may do. */
export interface MatchProposalLimits {
    /** How many (line, food) pairs are matched at once — each costs up to two catalog searches as the cook. */
    readonly concurrency: number;
    /** Time kept back from the deadline, after the last wave, for the refs read and the send. */
    readonly tailMs: number;
    /** Milliseconds since the epoch; injected so the budget is tested without wall time. */
    readonly now: () => number;
}

/**
 * Production's bounds, provided by `RecipesModule` under {@link MATCH_PROPOSAL_LIMITS}: four foods at a time, 1.5 s kept
 * for the refs read and the send, the wall clock.
 */
export const DEFAULT_MATCH_PROPOSAL_LIMITS: MatchProposalLimits = {
    concurrency: 4,
    tailMs: 1_500,
    now: () => Date.now(),
};

/** An abort signal that fires at `deadlineAt`, or one already aborted when that has passed. */
function signalUntil(deadlineAt: number, now: number): AbortSignal {
    const remaining = deadlineAt - now;

    return remaining > 0 ? AbortSignal.timeout(remaining) : AbortSignal.abort();
}

/** One parsed line of the job: its index, its stored digest, the parse's measure and its foods' names. */
interface ParsedLine extends ParsedLineMeasure {
    readonly lineIndex: number;
    readonly lineDigest: LineDigest;
    readonly phrases: readonly string[];
}

/** One (line, food) that needs a match: its slot, the line it belongs to, the food's name and its judgement. */
interface OwedSlot extends MatchSlot {
    readonly line: ParsedLine;
    readonly phrase: string;
    readonly judgementDigest: string;
}

/** A computed match before food has been asked about its proposal. */
type DraftMatch = Omit<NewParseJobMatch, 'verificationKey' | 'review'>;

/**
 * The judgement digest the CURRENT parse yields for one food of a line, or `undefined` when the line names no such food.
 * Pure.
 */
function judgementNow(line: ParsedLine, foodIndex: number): string | undefined {
    const phrase = line.phrases[foodIndex];

    return phrase === undefined
        ? undefined
        : matchJudgementDigestOf({ lineDigest: line.lineDigest, line, foodIndex, phrase }, sha256Hex);
}

/** Whether a stored row is still its line's match (rule 6). Pure. */
function isCurrentFor(lines: ReadonlyMap<number, ParsedLine>, match: ParseJobMatch): boolean {
    const line = lines.get(match.lineIndex);
    const judgementDigest = line === undefined ? undefined : judgementNow(line, match.foodIndex);

    return (
        line !== undefined &&
        judgementDigest !== undefined &&
        isCurrentMatch(match, { lineDigest: line.lineDigest, judgementDigest })
    );
}

/** Whether a current row's review is owed and may be claimed now: unclaimed, or claimed past the delivery bound. */
function isSendable(match: ParseJobMatch, nowMs: number): boolean {
    return (
        match.review === 'owed' &&
        match.verificationKey !== null &&
        match.proposal !== null &&
        (match.enqueuedAt === null || match.enqueuedAt.getTime() < nowMs - verificationDeliveryBoundSeconds() * 1_000)
    );
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
        @Inject(FoodCatalogGateway) private readonly catalog: Pick<FoodCatalogGateway, 'enabled' | 'searchTimeoutMs'>,
        private readonly refs: FoodRefsGateway,
        @Inject(VERIFICATION_QUEUE) private readonly queue: VerificationQueuePort,
        @Inject(RECIPE_LINE_VERIFICATIONS_DAL)
        private readonly verdicts: Pick<LineVerificationsDal, 'findExistingKeys'>,
        @Inject(MATCH_PROPOSAL_LIMITS) private readonly limits: MatchProposalLimits,
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
        // ⛔ ONE deadline for the whole call (rule 9), taken before any I/O.
        const deadlineAt = this.limits.now() + MATCH_PROPOSE_DEADLINE_MS;
        const ownerId = acting.userId;
        const job = await this.jobs.getJob(ownerId, jobId);

        if (job === undefined) {
            throw parseJobNotFound(jobId);
        }

        if (isParseJobExpired(job, this.limits.now())) {
            throw parseJobExpired(jobId);
        }

        if (!this.catalog.enabled) {
            // Rule 4: a switched-off catalog cannot rank, and a no-match stored now would stick.
            this.logger.warn(`parse-job ${jobId}: the catalog blend is switched off; no matches proposed`);

            return;
        }

        const lines = this.parsedLines(job);
        const stored = await this.matches.findForJob(ownerId, jobId);
        const current = new Map(
            stored.filter((match) => isCurrentFor(lines, match)).map((match) => [slotKey(match), match] as const),
        );
        const owed = [...lines.values()].flatMap((line) =>
            line.phrases.flatMap((phrase, foodIndex) => {
                const judgementDigest = judgementNow(line, foodIndex);

                return current.has(slotKey({ lineIndex: line.lineIndex, foodIndex })) || judgementDigest === undefined
                    ? []
                    : [{ lineIndex: line.lineIndex, foodIndex, line, phrase, judgementDigest }];
            }),
        );
        const drafts = await this.matchWithinBudget(ownerId, caller, owed, deadlineAt);
        // ONE batched refs read, under the deadline: the new proposals, and the stored ones this call may send (rule 9).
        const nowMs = this.limits.now();
        const answers = await this.askFoodAbout(
            caller,
            [
                ...drafts.flatMap((draft) => (draft.proposal === null ? [] : [draft.proposal.food])),
                ...[...current.values()].flatMap((match) =>
                    isSendable(match, nowMs) && match.proposal !== null ? [match.proposal.food] : [],
                ),
            ],
            deadlineAt,
        );
        const fresh = drafts.flatMap((draft) => this.withLiveProposal(jobId, draft, lines, answers));
        // A stored proposal is the LIVE end of what the chain named, so the message lookup is by that end too.
        const known = new Map(answers);

        for (const answer of answers.values()) {
            if (answer.outcome === 'found') {
                known.set(foodRefKey(liveEndOf(answer)), answer);
            }
        }

        await this.matches.saveMatches(jobId, fresh);
        await this.sendOwed(acting, jobId, lines, known, deadlineAt);
    }

    /**
     * The job's parsed lines that carry a proposal, by index, with the parse's measure and food names.
     *
     * @throws On a stored proposal this build cannot read — the writer is our own worker, so that is a defect.
     */
    private parsedLines(job: ParseJobRecord): ReadonlyMap<number, ParsedLine> {
        const parsed = new Map<number, ParsedLine>();

        for (const line of job.lines) {
            if (line.status !== 'parsed' || line.proposal === null) {
                continue;
            }

            const proposal = projectProposal(line.proposal);

            parsed.set(line.lineIndex, {
                lineIndex: line.lineIndex,
                lineDigest: parseStoredLineDigest(line.lineDigest),
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
     * Match the owed slots in waves while a wave can still finish in time (rule 9): a wave starts only when its searches,
     * at their transport timeout, end before the tail kept for the refs read and the send.
     *
     * @returns A draft per slot the chain could answer for; a slot it could not look for is left out (rule 4).
     * @sideEffect Runs the proposal chain as the caller.
     */
    private async matchWithinBudget(
        ownerId: string,
        caller: CallerToken | undefined,
        owed: readonly OwedSlot[],
        deadlineAt: number,
    ): Promise<readonly DraftMatch[]> {
        const lastStart = deadlineAt - this.limits.tailMs - SEARCHES_PER_FOOD * this.catalog.searchTimeoutMs();
        const drafts: DraftMatch[] = [];
        const width = Math.max(1, this.limits.concurrency);

        for (let start = 0; start < owed.length; start += width) {
            if (this.limits.now() > lastStart) {
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
        const base = {
            lineIndex: slot.lineIndex,
            foodIndex: slot.foodIndex,
            lineDigest: slot.line.lineDigest,
            judgementDigest: slot.judgementDigest,
        };
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

        if (outcome.kind === 'resolved' && !isMatchProposingTier(outcome.tier)) {
            // The proposal registry holds exactly the proposing tiers; another is a wiring defect, not a no-match.
            throw new Error(`tier '${outcome.tier}' cannot propose a paste match`);
        }

        return {
            ...base,
            proposal:
                outcome.kind === 'resolved' && food !== undefined && isMatchProposingTier(outcome.tier)
                    ? {
                          matchedBy: outcome.tier,
                          food,
                          rung: rankTierOf(outcome.rung),
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
     * Ask food about these refs, as the caller, in one batched read under the request deadline. Past the deadline it asks
     * nothing: every ref is `unreachable`, so nothing is stored and the next call asks again (rule 4).
     *
     * @sideEffect One batched refs read.
     */
    private async askFoodAbout(
        caller: CallerToken | undefined,
        refs: readonly FoodRef[],
        deadlineAt: number,
    ): Promise<ReadonlyMap<string, FoodRefAnswer>> {
        const now = this.limits.now();

        if (refs.length === 0 || now >= deadlineAt) {
            return new Map();
        }

        return (await this.refs.resolve(caller, refs, 'postCommit', { signal: signalUntil(deadlineAt, now) })).answers;
    }

    /**
     * Finish a draft with what food said about its proposal: moved to its live end, keyed, and its review disposition
     * decided (rule 7); dropped when food no longer shows it; or not stored at all when food could not be asked (rule 4).
     *
     * @returns Zero or one match. Pure given the answers, apart from the error log for a request the contract refuses.
     */
    private withLiveProposal(
        jobId: string,
        draft: DraftMatch,
        lines: ReadonlyMap<number, ParsedLine>,
        answers: ReadonlyMap<string, FoodRefAnswer>,
    ): readonly NewParseJobMatch[] {
        const line = lines.get(draft.lineIndex);

        if (draft.proposal === null || line === undefined) {
            return [{ ...draft, verificationKey: null, review: null }];
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
                    review: null,
                },
            ];
        }

        const food = liveEndOf(answer);
        const proposal = { ...draft.proposal, food };
        // ⛔ The key is the key of the request this row will send: the worker writes the verdict under it.
        const message = proposalMessageOf({
            jobId,
            slot: draft,
            line,
            food,
            answer,
            requestedAt: new Date().toISOString(),
        });

        if (message === undefined) {
            const review: MatchReview | null =
                proposalVerificationDecision(line.sourceLine, food.kind).kind === 'reject' ? 'refused' : null;

            return [{ ...draft, proposal, verificationKey: null, review }];
        }

        if (!verifyIngredientLineMessageSchema.safeParse(message).success) {
            // ⛔ Undeliverable: the consumer's own contract refuses it, so sending would only fail. Refused and parked,
            // never claimed and released on every poll. The line still holds its proposal.
            this.logger.error(
                `parse-job ${jobId}: the queue contract refuses the review of line ${String(draft.lineIndex)} food ` +
                    `${String(draft.foodIndex)}; it is stored as refused and never sent`,
            );

            return [{ ...draft, proposal, verificationKey: null, review: 'refused' }];
        }

        return [{ ...draft, proposal, verificationKey: proposalKeyOf(message, sha256Hex), review: 'owed' }];
    }

    /**
     * Send one verification request for every current match that is owed one (rule 5).
     *
     * ⛔ NOTHING for a CONTAINED test principal (ADR-0040), and that check is the FIRST statement. The review spends
     * ADR-0024's shared production pool, which a test principal is contained from, exactly as the save path's
     * producer is (`RecipesService.requestVerification`). The proposals stay the cook's own rows.
     *
     * A row a concurrent call stored, whose food this call did not ask about, waits for the next call: food is asked
     * once per call (rule 9).
     *
     * @sideEffect Reads the matches and the verdict table, claims, enqueues, and releases its own claims on failure.
     */
    private async sendOwed(
        subject: ContainmentSubject & Pick<ActingPrincipal, 'userId'>,
        jobId: string,
        lines: ReadonlyMap<number, ParsedLine>,
        answers: ReadonlyMap<string, FoodRefAnswer>,
        deadlineAt: number,
    ): Promise<void> {
        // A contained principal never sends (ADR-0040); past the deadline nothing is claimed, and the next call sends.
        if (isContained(subject) || this.limits.now() >= deadlineAt) {
            return;
        }

        const nowMs = this.limits.now();
        const owed = (await this.matches.findForJob(subject.userId, jobId)).filter(
            (match) => isCurrentFor(lines, match) && isSendable(match, nowMs),
        );

        if (owed.length === 0) {
            return;
        }

        const unjudged = await withoutVerdictsOnRecord(
            this.verdicts,
            owed,
            (match) => match.verificationKey,
            (error) =>
                this.logger.warn(
                    `parse-job ${jobId}: verdict dedup read failed; asking about all ${String(owed.length)} proposal(s)`,
                    error instanceof Error ? error.stack : String(error),
                ),
        );
        const requests = unjudged.flatMap((match) => {
            const message = this.messageFor(jobId, match, lines, answers);

            return message === undefined || match.verificationKey === null
                ? []
                : [{ match, message, verificationKey: match.verificationKey }];
        });
        const won = await this.matches.claimEnqueue(
            jobId,
            requests.map(({ match, verificationKey }) => ({
                lineIndex: match.lineIndex,
                foodIndex: match.foodIndex,
                lineDigest: match.lineDigest,
                verificationKey,
            })),
            verificationDeliveryBoundSeconds(),
        );
        const messages = new Map(requests.map(({ match, message }) => [slotKey(match), message] as const));
        const toSend = won.flatMap((claim) => {
            const message = messages.get(slotKey(claim));

            return message === undefined ? [] : [{ claim, message }];
        });

        if (toSend.length === 0) {
            return;
        }

        try {
            await this.queue.enqueue(
                toSend.map(({ message }) => message),
                // ⛔ The deadline reaches SQS: an aborted send is undelivered, and its claims are released below.
                { signal: signalUntil(deadlineAt, this.limits.now()) },
            );
        } catch (error) {
            const lost = isBatchEnqueueError(error)
                ? error.undeliveredIndexes.flatMap((index) => {
                      const sent = toSend[index];

                      return sent === undefined ? [] : [sent.claim];
                  })
                : toSend.map(({ claim }) => claim);

            this.logger.warn(
                `parse-job ${jobId}: verification enqueue failed for ${String(lost.length)} of ` +
                    `${String(toSend.length)} proposal(s); their claims are released for the next call`,
                error instanceof Error ? error.stack : String(error),
            );
            await this.matches.releaseEnqueue(jobId, lost);
        }
    }

    /**
     * The verification request for one stored match, or `undefined` when nothing can be sent for it.
     *
     * ⛔ The request is rebuilt from the same inputs the row's key was derived from, and it is sent only when its key IS
     * the row's key. A mismatch would land the verdict under a key the job view never reads, so it is refused and logged
     * at error: it can only mean the derivation changed between the call that stored the row and this one.
     *
     * Pure apart from that log.
     */
    private messageFor(
        jobId: string,
        match: ParseJobMatch,
        lines: ReadonlyMap<number, ParsedLine>,
        answers: ReadonlyMap<string, FoodRefAnswer>,
    ): VerifyIngredientLineMessage | undefined {
        const line = lines.get(match.lineIndex);
        const food = match.proposal?.food;
        const answer = food === undefined ? undefined : answers.get(foodRefKey(food));

        if (line === undefined || food === undefined || answer === undefined) {
            return undefined;
        }

        const message = proposalMessageOf({ jobId, slot: match, line, food, answer, requestedAt: new Date().toISOString() });

        if (message === undefined) {
            return undefined;
        }

        if (proposalKeyOf(message, sha256Hex) !== match.verificationKey) {
            this.logger.error(
                `parse-job ${jobId}: the stored verdict key of line ${String(match.lineIndex)} food ` +
                    `${String(match.foodIndex)} is not the key of the request it would send; nothing is sent`,
            );

            return undefined;
        }

        return message;
    }
}
