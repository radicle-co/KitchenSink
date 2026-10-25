/**
 * `ParseJobMatchView` (ADR-0071) — adds each proposed food's `match` to a parse-job view, at READ time.
 *
 * DESIGN PATTERN: **Decorator** over the job view `ParseJobsService` builds: it takes a finished view and returns the
 * same view with `match` on every proposed food, so the service that owns the job's lifecycle knows nothing about
 * matching, and every route that answers with a view goes through the one projection. The state itself is the pure
 * `matchStateOf` (`domain/matchState.ts`).
 *
 * ## The rules that live HERE
 *
 *  1. **Names at read time, as the caller** (ADR-0045). The match store holds ids only; food names them on this read,
 *     so a food renamed, retired or made private since is shown as food says now: at its live end, or not at all.
 *  2. **A food that could not be asked shows NO match**, never a nameless or stale one. The client keeps polling.
 *  3. **A stale row is ignored.** The digest is recomputed from the line as the view shows it (`lineDigest`, the same
 *     function the line was stored with), and a row matched for other text is not this line's match.
 *  4. **Total.** An unreadable match store or verdict table degrades every food to `match: null` or to "no verdict
 *     yet", with a log line; a poll never fails on an auxiliary read (the assembler's posture).
 *
 * A curated proposal the gate contradicted is counted (coordinator decision 3) so curation can be reviewed. ⚠️ The
 * count is PER READ, not per mapping: a poll loop counts the same line several times. It is a signal to look, not a
 * tally of mappings.
 */
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { lineDigest } from '@kitchensink/recipe-core/parsing/parse-key';

import type { CallerToken } from '../auth/CallerToken.js';
import { buildStageCountMetricLine, resolveMetricStage } from '../common/emfMetricLine.js';
import { sha256Hex } from '../common/sha256.js';
import { foodRefKey, type FoodRef } from '../database/schema/foodLookupArm.js';
import type { FoodRefAnswer } from '../ingredients/domain/foodRefAnswer.js';
import { FoodRefsGateway } from '../ingredients/foodRefs.gateway.js';
import type { LineVerdictRow, LineVerificationsDal } from './dal/lineVerifications.dal.js';
import { variantDisplayName } from './domain/lineVerification.js';
import { isDefaultRung, proposalVerificationDecision } from './domain/matchProposal.js';
import { matchStateOf } from './domain/matchState.js';
import type { ParseJobMatch, ParseJobMatchesPort } from './domain/parseJobMatch.js';
import { PARSE_JOB_MATCHES_DAL } from './matchProposal.service.js';
import type { ParseJobResponse, ParseProposalCandidate, ParseProposalMatch } from './parseJobs.schema.js';
import { RECIPE_LINE_VERIFICATIONS_DAL } from './recipes.tokens.js';

/** DI token for where a curated-but-contradicted proposal is reported. */
export const CURATION_DISAGREEMENT_SINK = 'CURATION_DISAGREEMENT_SINK';

/** What a curated-but-contradicted report carries: ids only, never the cook's text. */
export interface CurationDisagreement {
    readonly jobId: string;
    readonly foodId: string;
}

/** The CloudWatch namespace and metric for a curated mapping the gate contradicted on a paste line. */
const CURATION_NAMESPACE = 'Commise/RecipeResolution';
const CURATION_METRIC = 'paste-curated-contradicted';

/** The default report: one EMF count, dimensioned by stage alone. */
function emitCurationDisagreement(): void {
    console.log(
        buildStageCountMetricLine({
            namespace: CURATION_NAMESPACE,
            metricName: CURATION_METRIC,
            stage: resolveMetricStage(),
        }),
    );
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

/** Whether an answer is found and named. Pure. */
function isNamed(answer: FoodRefAnswer | undefined): answer is NamedAnswer {
    return answer?.outcome === 'found' && answer.name !== undefined;
}

@Injectable()
export class ParseJobMatchView {
    private readonly logger = new Logger(ParseJobMatchView.name);

    public constructor(
        @Inject(PARSE_JOB_MATCHES_DAL) private readonly matches: Pick<ParseJobMatchesPort, 'findForJob'>,
        @Inject(RECIPE_LINE_VERIFICATIONS_DAL)
        private readonly verdicts: Pick<LineVerificationsDal, 'findBandsByKeys' | 'findExhaustedKeys'>,
        @Inject(FoodRefsGateway) private readonly refs: Pick<FoodRefsGateway, 'resolve'>,
        @Optional()
        @Inject(CURATION_DISAGREEMENT_SINK)
        private readonly reportCurationDisagreement: (report: CurationDisagreement) => void = emitCurationDisagreement,
    ) {}

    /**
     * The view with `match` on every proposed food: the derived match, or `null` when there is none to show.
     *
     * @param ownerId - The caller; only their job's matches are read.
     * @param caller - The caller's credential, forwarded to food for names.
     * @param view - The job view.
     * @returns The decorated view. Never throws for an auxiliary read.
     * @sideEffect Reads the match store and the verdict tables, and food's refs as the caller.
     */
    public async decorate(
        ownerId: string,
        caller: CallerToken | undefined,
        view: ParseJobResponse,
    ): Promise<ParseJobResponse> {
        const current = await this.currentMatches(ownerId, view);

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

        return this.withMatches(view, (lineIndex, foodIndex, sourceLine) => {
            const match = current.get(`${String(lineIndex)}:${String(foodIndex)}`);

            return match === undefined ? null : this.project(view.id, match, sourceLine, answers, verdicts, exhausted);
        });
    }

    /** The matches whose digest still equals their line's, by slot. An unreadable store is no matches (rule 4). */
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

        const digests = new Map(view.lines.map((line) => [line.lineIndex, lineDigest(line.sourceLine, sha256Hex)]));

        return new Map(
            stored
                .filter((match) => digests.get(match.lineIndex) === match.lineDigest)
                .map((match) => [`${String(match.lineIndex)}:${String(match.foodIndex)}`, match] as const),
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
        jobId: string,
        match: ParseJobMatch,
        sourceLine: string,
        answers: ReadonlyMap<string, FoodRefAnswer>,
        verdicts: ReadonlyMap<string, LineVerdictRow>,
        exhausted: ReadonlySet<string>,
    ): ParseProposalMatch | null {
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
                verdict === undefined ? undefined : { band: verdict.band, identityVerdict: verdict.identityVerdict },
            review: this.reviewOf(match, sourceLine, proposed?.kind, exhausted),
        });

        if (answer.reviewNote === 'reviewDisagreed' && proposed !== null) {
            this.reportQuietly({ jobId, foodId: proposed.id });
        }

        return {
            state: answer.state,
            reason: answer.reason,
            proposed,
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
            const key = `${food.kind}:${food.id}`;

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

    /** Where the review stands when there is no verdict. Pure. */
    private reviewOf(
        match: ParseJobMatch,
        sourceLine: string,
        kind: FoodRef['kind'] | undefined,
        exhausted: ReadonlySet<string>,
    ): 'asked' | 'refused' | 'exhausted' {
        if (match.verificationKey === null) {
            return kind !== undefined && proposalVerificationDecision(sourceLine, kind).kind === 'reject'
                ? 'refused'
                : 'asked';
        }

        return exhausted.has(match.verificationKey) ? 'exhausted' : 'asked';
    }

    /** Report a curated-but-contradicted proposal; the report never fails the read. */
    private reportQuietly(report: CurationDisagreement): void {
        try {
            this.reportCurationDisagreement(report);
            this.logger.warn('A curated mapping was contradicted by the review gate on a paste line.', report);
        } catch {
            // Observability must not become an availability dependency.
        }
    }

    /** The view with `match` set on every proposed food by `matchFor`. Pure. */
    private withMatches(
        view: ParseJobResponse,
        matchFor: (lineIndex: number, foodIndex: number, sourceLine: string) => ParseProposalMatch | null,
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
                                  match: matchFor(line.lineIndex, foodIndex, line.sourceLine),
                              })),
                          },
                      },
            ),
        };
    }
}
