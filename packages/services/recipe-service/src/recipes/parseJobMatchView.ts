/**
 * `ParseJobMatchView` (ADR-0071) — adds each proposed food's `match` to a parse-job view, at READ time.
 *
 * DESIGN PATTERN: **Content Enricher** (Hohpe and Woolf) over the job view `ParseJobsService` builds: it takes a finished
 * view and returns the same view with `match` on every proposed food, filled from the match store, the verdict table and
 * food. The service that owns the job's lifecycle knows nothing about matching, and every route that answers with a view
 * goes through this one projection (`parseJobsController.enrichment.test.ts` discovers the routes and drives each). The
 * state itself is the pure `matchStateOf` (`domain/matchState.ts`).
 *
 * ## The rules that live HERE
 *
 *  1. **Names at read time, as the caller** (ADR-0045). The match store holds ids only; food names them on this read,
 *     so a food renamed, retired or made private since is shown as food says now: at its live end, or not at all.
 *  2. **A food that could not be asked shows NO match**, never a nameless or stale one. The client keeps polling.
 *  3. **A stale row is ignored.** `isCurrentMatch`, the rule the matcher applies too: the line's STORED digest (read
 *     with the row, never recomputed from the text) and the judgement digest of the parse this view shows. A row
 *     matched for other text, or for another parse of the same text, is not this line's match.
 *  4. **Total.** An unreadable match store or verdict table degrades every food to `match: null` or to "no verdict
 *     yet", with a log line; a poll never fails on an auxiliary read (the assembler's posture).
 *
 * A curated proposal the gate contradicted is counted (coordinator decision 3) so curation can be reviewed, ONCE per row
 * and verdict: the store's `claimCurationReport` lets only the first read that sees it report it, so a poll loop does
 * not inflate the count. A replaced row (the line edited or reparsed) counts afresh.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';

import type { CallerToken } from '../auth/CallerToken.js';
import type { ActingPrincipal } from '../auth/principal.js';
import { isContained } from '../common/containmentPolicy.js';
import { buildStageCountMetricLine, resolveMetricStage } from '../common/emfMetricLine.js';
import { sha256Hex } from '../common/sha256.js';
import { foodRefKey, type FoodRef } from '../database/schema/foodLookupArm.js';
import type { FoodRefAnswer } from '../ingredients/domain/foodRefAnswer.js';
import { FoodRefsGateway } from '../ingredients/foodRefs.gateway.js';
import { RECIPE_RESOLUTION_NAMESPACE } from '../ingredients/resolution/resolutionMetrics.js';
import type { LineVerdictRow, LineVerificationsDal } from './dal/lineVerifications.dal.js';
import { variantDisplayName } from './domain/lineVerification.js';
import { isDefaultRung, matchJudgementDigestOf } from './domain/matchProposal.js';
import { matchStateOf, proposalShownIn } from './domain/matchState.js';
import { isCurrentMatch, slotKey, type ParseJobMatch, type ParseJobMatchesPort } from './domain/parseJobMatch.js';
import { PARSE_JOB_MATCHES_DAL } from './matchProposal.service.js';
import type { ParseJobResponse, ParseProposalCandidate, ParseProposalMatch } from './parseJobs.schema.js';
import { RECIPE_LINE_VERIFICATIONS_DAL } from './recipes.tokens.js';

/** DI token for where a curated-but-contradicted proposal is reported (provided by `RecipesModule`). */
export const CURATION_DISAGREEMENT_SINK = 'CURATION_DISAGREEMENT_SINK';

/** What a curated-but-contradicted report carries: ids only, never the cook's text. */
export interface CurationDisagreement {
    readonly jobId: string;
    readonly foodId: string;
}

/** The metric for a curated mapping the gate contradicted on a paste line, under the one resolution namespace. */
const CURATION_METRIC = 'paste-curated-contradicted';

/**
 * Production's report: one EMF count, dimensioned by stage alone.
 *
 * @sideEffect Writes one EMF line to stdout.
 */
export function emitCurationDisagreement(): void {
    console.log(
        buildStageCountMetricLine({
            namespace: RECIPE_RESOLUTION_NAMESPACE,
            metricName: CURATION_METRIC,
            stage: resolveMetricStage(),
        }),
    );
}

/** A curated contradiction this read saw, waiting for its one count. */
interface CurationReport {
    readonly match: ParseJobMatch;
    readonly verificationKey: string;
    readonly foodId: string;
}

/** A found answer that carries a usable name. */
type NamedAnswer = Extract<FoodRefAnswer, { outcome: 'found' }> & { readonly name: string };

/** The food a found answer says the ref LIVES at, named as food names it. Pure. */
function namedFood(answer: NamedAnswer): {
    readonly kind: FoodRef['kind'];
    readonly id: string;
    readonly name: string;
} {
    return answer.variant === undefined
        ? { kind: 'root', id: answer.rootId, name: answer.name }
        : { kind: 'variant', id: answer.variant.id, name: variantDisplayName(answer.name, answer.variant.parts) };
}

/**
 * Whether an answer is found and carries a NON-EMPTY name. Pure.
 *
 * ⛔ Non-empty, not merely present: the wire's `name` is `min(1)`, so one empty name would fail the whole response.
 * Dropping that one food loses a single option; relaxing the wire would widen a contract installed clients parse.
 */
function isNamed(answer: FoodRefAnswer | undefined): answer is NamedAnswer {
    return answer?.outcome === 'found' && answer.name !== undefined && answer.name.length > 0;
}

@Injectable()
export class ParseJobMatchView {
    private readonly logger = new Logger(ParseJobMatchView.name);

    public constructor(
        @Inject(PARSE_JOB_MATCHES_DAL)
        private readonly matches: Pick<ParseJobMatchesPort, 'findForJob' | 'claimCurationReport'>,
        @Inject(RECIPE_LINE_VERIFICATIONS_DAL)
        private readonly verdicts: Pick<LineVerificationsDal, 'findBandsByKeys' | 'findExhaustedKeys'>,
        @Inject(FoodRefsGateway) private readonly refs: Pick<FoodRefsGateway, 'resolve'>,
        @Inject(CURATION_DISAGREEMENT_SINK)
        private readonly reportCurationDisagreement: (report: CurationDisagreement) => void,
    ) {}

    /**
     * The view with `match` on every proposed food: the derived match, or `null` when there is none to show.
     *
     * @param acting - The verified caller: only their job's matches are read, and a CONTAINED test principal's reviews,
     *   which are never sent (ADR-0040), read `needsChoice` instead of `checking` forever.
     * @param caller - The caller's credential, forwarded to food for names.
     * @param view - The job view.
     * @returns The decorated view. Never throws for an auxiliary read.
     * @sideEffect Reads the match store and the verdict tables, and food's refs as the caller.
     */
    public async decorate(
        acting: ActingPrincipal,
        caller: CallerToken | undefined,
        view: ParseJobResponse,
    ): Promise<ParseJobResponse> {
        const current = await this.currentMatches(acting.userId, view);

        if (current.size === 0) {
            return this.withMatches(view, () => null);
        }

        const keys = [...current.values()].flatMap((match) =>
            match.verificationKey === null ? [] : [match.verificationKey],
        );
        const [verdicts, exhausted, answers] = await Promise.all([
            this.readVerdicts(view.id, keys),
            this.readExhausted(view.id, keys),
            this.namesFor(caller, [...current.values()]),
        ]);

        const contained = isContained(acting);
        const toReport: CurationReport[] = [];
        const decorated = this.withMatches(view, (lineIndex, foodIndex) => {
            const match = current.get(slotKey({ lineIndex, foodIndex }));

            return match === undefined
                ? null
                : this.project(match, { answers, verdicts, exhausted, contained, toReport });
        });

        await this.reportOnce(view.id, toReport);

        return decorated;
    }

    /** The matches that are still their line's (rule 3), by slot. An unreadable store is no matches (rule 4). */
    private async currentMatches(ownerId: string, view: ParseJobResponse): Promise<ReadonlyMap<string, ParseJobMatch>> {
        let stored: readonly ParseJobMatch[];

        try {
            stored = await this.matches.findForJob(ownerId, view.id);
        } catch (error) {
            this.logger.warn(
                `parse-job ${view.id}: matches could not be read; the view shows none`,
                error instanceof Error ? error.stack : String(error),
            );

            return new Map();
        }

        const lines = new Map(view.lines.map((line) => [line.lineIndex, line]));

        return new Map(
            stored
                .filter((match) => {
                    const line = lines.get(match.lineIndex);
                    const phrase = line?.proposal?.foods[match.foodIndex]?.name;

                    if (line?.proposal === null || line?.proposal === undefined || phrase === undefined) {
                        return false;
                    }

                    // ⛔ The STORED digest (item 8): the store read it with the row; nothing here re-derives one.
                    const judgementDigest = matchJudgementDigestOf(
                        {
                            lineDigest: match.lineDigestNow,
                            line: { sourceLine: line.sourceLine, ...line.proposal },
                            foodIndex: match.foodIndex,
                            phrase,
                        },
                        sha256Hex,
                    );

                    return isCurrentMatch(match, { lineDigest: match.lineDigestNow, judgementDigest });
                })
                .map((match) => [slotKey(match), match] as const),
        );
    }

    /** The gate's verdicts by key; an unreadable table is "no verdict yet". */
    private async readVerdicts(jobId: string, keys: readonly string[]): Promise<ReadonlyMap<string, LineVerdictRow>> {
        try {
            return await this.verdicts.findBandsByKeys(keys);
        } catch (error) {
            this.logger.warn(
                `parse-job ${jobId}: verdicts could not be read; proposals read as awaiting review`,
                error instanceof Error ? error.stack : String(error),
            );

            return new Map();
        }
    }

    /** The keys the gate gave up on; an unreadable table is none. */
    private async readExhausted(jobId: string, keys: readonly string[]): Promise<ReadonlySet<string>> {
        try {
            return await this.verdicts.findExhaustedKeys(keys);
        } catch (error) {
            this.logger.warn(
                `parse-job ${jobId}: verification attempts could not be read`,
                error instanceof Error ? error.stack : String(error),
            );

            return new Set();
        }
    }

    /** Food's answer about every proposed and candidate food, in one batched read as the caller. */
    private async namesFor(
        caller: CallerToken | undefined,
        matches: readonly ParseJobMatch[],
    ): Promise<ReadonlyMap<string, FoodRefAnswer>> {
        const refs = matches.flatMap((match) => [
            ...(match.proposal === null ? [] : [match.proposal.food]),
            ...match.candidates.map(({ kind, id }) => ({ kind, id })),
        ]);

        return (await this.refs.resolve(caller, refs, 'read')).answers;
    }

    /**
     * One food's match, or `null` when food could not be asked about it (rule 2). Pure apart from the curation report.
     */
    private project(
        match: ParseJobMatch,
        read: {
            readonly answers: ReadonlyMap<string, FoodRefAnswer>;
            readonly verdicts: ReadonlyMap<string, LineVerdictRow>;
            readonly exhausted: ReadonlySet<string>;
            readonly contained: boolean;
            /** Where a curated contradiction to count is collected, for {@link ParseJobMatchView.reportOnce}. */
            readonly toReport: CurationReport[];
        },
    ): ParseProposalMatch | null {
        const { answers, verdicts } = read;
        const answerOf = (ref: FoodRef): FoodRefAnswer => answers.get(foodRefKey(ref)) ?? { outcome: 'unreachable' };
        const asked = [...(match.proposal === null ? [] : [match.proposal.food]), ...match.candidates];

        if (asked.some((ref) => answerOf(ref).outcome === 'unreachable')) {
            return null;
        }

        const proposalAnswer = match.proposal === null ? undefined : answerOf(match.proposal.food);
        const proposed = isNamed(proposalAnswer) ? namedFood(proposalAnswer) : null;
        const candidates = this.candidatesOf(match, answerOf);
        const verdict = match.verificationKey === null ? undefined : verdicts.get(match.verificationKey);
        const answer = matchStateOf({
            proposal:
                match.proposal === null || proposed === null
                    ? undefined
                    : { matchedBy: match.proposal.matchedBy, rung: match.proposal.rung },
            candidateCount: candidates.length,
            defaultApplies: candidates.some((candidate) => candidate.isDefault),
            verdict:
                verdict === undefined
                    ? undefined
                    : { band: verdict.band, identityVerdict: verdict.identityVerdict, aspects: verdict.aspects },
            review: this.reviewOf(match, read.exhausted, read.contained),
        });

        if (answer.reviewNote === 'reviewDisagreed' && proposed !== null && match.verificationKey !== null) {
            read.toReport.push({ match, verificationKey: match.verificationKey, foodId: proposed.id });
        }

        return {
            state: answer.state,
            reason: answer.reason,
            // ⛔ The policy decides: a rejected, contradicted or default proposal is shown only as a candidate.
            proposed: proposalShownIn(answer.state) ? proposed : null,
            candidates,
            ...(answer.reviewNote === undefined ? {} : { reviewNote: answer.reviewNote }),
        };
    }

    /** The named candidates at their live ends, a default first, then food's order; one entry per food. Pure. */
    private candidatesOf(match: ParseJobMatch, answerOf: (ref: FoodRef) => FoodRefAnswer): ParseProposalCandidate[] {
        const seen = new Set<string>();
        const named: ParseProposalCandidate[] = [];

        for (const candidate of match.candidates) {
            const answer = answerOf(candidate);

            if (!isNamed(answer)) {
                continue;
            }

            const food = namedFood(answer);
            const key = foodRefKey(food);

            if (!seen.has(key)) {
                seen.add(key);
                named.push({ ...food, isDefault: isDefaultRung(candidate.rung) });
            }
        }

        return [
            ...named.filter((candidate) => candidate.isDefault),
            ...named.filter((candidate) => !candidate.isDefault),
        ];
    }

    /**
     * Where the review stands when there is no verdict: the row's PERSISTED disposition (F10), never the gate policy
     * re-run here; and for a contained test principal, whose review is never sent (ADR-0040), `notAsked`. Pure.
     */
    private reviewOf(
        match: ParseJobMatch,
        exhausted: ReadonlySet<string>,
        contained: boolean,
    ): 'asked' | 'refused' | 'exhausted' | 'notAsked' {
        if (match.review === 'refused') {
            return 'refused';
        }

        if (match.verificationKey !== null && exhausted.has(match.verificationKey)) {
            return 'exhausted';
        }

        return contained ? 'notAsked' : 'asked';
    }

    /**
     * Count each curated contradiction ONCE per row and verdict (item 18): only a report whose store claim this read won
     * is emitted. Neither the claim nor the report may fail the read.
     *
     * @sideEffect Conditional writes of the store's marker; one EMF line per won claim.
     */
    private async reportOnce(jobId: string, reports: readonly CurationReport[]): Promise<void> {
        for (const report of reports) {
            try {
                const won = await this.matches.claimCurationReport(jobId, {
                    lineIndex: report.match.lineIndex,
                    foodIndex: report.match.foodIndex,
                    verificationKey: report.verificationKey,
                });

                if (won) {
                    this.reportCurationDisagreement({ jobId, foodId: report.foodId });
                    this.logger.warn('A curated mapping was contradicted by the review gate on a paste line.', {
                        jobId,
                        foodId: report.foodId,
                    });
                }
            } catch (error) {
                // Observability must not become an availability dependency.
                this.logger.warn(
                    `parse-job ${jobId}: a curated contradiction could not be counted`,
                    error instanceof Error ? error.stack : String(error),
                );
            }
        }
    }

    /** The view with `match` set on every proposed food by `matchFor`. Pure. */
    private withMatches(
        view: ParseJobResponse,
        matchFor: (lineIndex: number, foodIndex: number) => ParseProposalMatch | null,
    ): ParseJobResponse {
        return {
            ...view,
            lines: view.lines.map((line) =>
                line.proposal === null
                    ? line
                    : {
                          ...line,
                          proposal: {
                              ...line.proposal,
                              foods: line.proposal.foods.map((food, foodIndex) => ({
                                  ...food,
                                  match: matchFor(line.lineIndex, foodIndex),
                              })),
                          },
                      },
            ),
        };
    }
}
