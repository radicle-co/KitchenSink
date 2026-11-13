/**
 * `ImportLineView` — gives a bulk import's snapshot lines their MATCH and their FLAG, as the caller (ADR-0072 §4, §6).
 *
 * DESIGN PATTERN: **Content Enricher** (Hohpe and Woolf), the sibling of `ParseJobMatchView`. The import stores ids and the
 * cook's own words and no food name, no verdict and no flag; every view adds them at READ time:
 *
 *  1. **One projection of a match.** `matchesOf` reads a snapshot line back as the paste matcher's `ParseJobMatch`
 *     (`matchOfSnapshotLine`) and projects it through `projectMatch`, the very function the paste screen uses, so the wizard,
 *     the lists and the paste cannot disagree about what a verdict means. The verdict is read BY KEY on every view; a verdict
 *     that lands after the snapshot still reaches the line.
 *  2. **Names at read time, as the caller, in ONE batched read** (ADR-0045). A food food could not be asked about is `null`,
 *     never a name from storage.
 *  3. **Flagged is derived from the SAVED line's verdict** (`saved_verification_key`), because the snapshot's own key judges the
 *     PROPOSED food and a line bound to its default or best match is judged under another. It goes through the one classifier
 *     `identityReadingOf` and the third mapping `importFlagOf`; nothing is stored.
 *  4. **Total and bounded.** The facts come from `readMatchFacts`, the paste view's own read side: each read ends with the
 *     request's deadline, and an unreadable one degrades to "no verdict yet" with a log line, never a failed poll.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';

import type { CallerToken } from '../auth/CallerToken.js';
import type { ActingPrincipal } from '../auth/principal.js';
import { foodRefKey, foodRefOf, type FoodRef } from '../database/schema/foodLookupArm.js';
import { FoodLookupsDal } from '../ingredients/dal/foodLookups.dal.js';
import { FoodRefsGateway } from '../ingredients/foodRefs.gateway.js';
import type { LineVerificationsDal } from '../recipes/dal/lineVerifications.dal.js';
import { identityReadingOf } from '../recipes/domain/lineVerification.js';
import { isDefaultRung } from '../recipes/domain/matchProposal.js';
import { reviewStandingOf } from '../recipes/domain/reviewStanding.js';
import { foodsOfMatch, isNamed, namedFood, projectMatch, readMatchFacts } from '../recipes/parseJobMatchView.js';
import type { ParseProposalMatch } from '../recipes/parseJobs.schema.js';
import type { ImportFlag } from '../recipes/import.schema.js';
import { RECIPE_LINE_VERIFICATIONS_DAL } from '../recipes/recipes.tokens.js';
import type { ImportLine, ListedLine } from './dal/recipeImportLines.dal.js';
import { importFlagOf } from './domain/importFlagPolicy.js';
import { matchOfSnapshotLine } from './domain/snapshotMatch.js';

/** A food by id with the name food gave it on this read, or `null` when food could not name it. */
interface FoodRefView {
    readonly kind: FoodRef['kind'];
    readonly id: string;
    readonly name: string | null;
}

/** What a flaggable line reads as now: the food it is bound to, and the derived flag. */
export interface FlaggedRead {
    readonly bound: FoodRefView;
    readonly flag: ImportFlag;
}

/** The seeded default among a snapshot line's candidates, read from its rung (the fact the default is). Pure. */
function defaultCandidateOf(line: ImportLine): FoodRef | undefined {
    const found = matchOfSnapshotLine(line).candidates.find((candidate) => isDefaultRung(candidate.rung));

    return found === undefined ? undefined : { kind: found.kind, id: found.id };
}

@Injectable()
export class ImportLineView {
    private readonly logger = new Logger(ImportLineView.name);

    public constructor(
        @Inject(RECIPE_LINE_VERIFICATIONS_DAL)
        private readonly verdicts: Pick<
            LineVerificationsDal,
            'findBandsByKeys' | 'findExhaustedKeys' | 'findBudgetSpentKeys'
        >,
        @Inject(FoodRefsGateway) private readonly refs: Pick<FoodRefsGateway, 'resolve'>,
        @Inject(FoodLookupsDal) private readonly lookups: Pick<FoodLookupsDal, 'findByIds'>,
    ) {}

    /**
     * The match view of each snapshot line.
     *
     * @param acting - The verified caller (a contained test principal's reviews are never sent, ADR-0040).
     * @param caller - The caller's credential, forwarded to food for names.
     * @param lines - The snapshot lines.
     * @param deadline - The request's deadline, when it has one.
     * @returns Line id → match; `null` for a line whose foods food could not be asked about. @sideEffect Reads.
     */
    public async matchesOf(
        acting: ActingPrincipal,
        caller: CallerToken | undefined,
        lines: readonly ImportLine[],
        deadline?: AbortSignal,
    ): Promise<ReadonlyMap<string, ParseProposalMatch | null>> {
        if (lines.length === 0) {
            return new Map();
        }

        const matches = lines.map((line) => ({ line, match: matchOfSnapshotLine(line) }));
        const read = await this.readFacts(acting, caller, deadline, {
            keys: matches.flatMap(({ match }) => (match.verificationKey === null ? [] : [match.verificationKey])),
            foods: matches.flatMap(({ match }) => foodsOfMatch(match)),
        });

        return new Map(matches.map(({ line, match }) => [line.id, projectMatch(match, { ...read, toReport: [] })]));
    }

    /**
     * The flag of each saved, import-bound line, with the food it is bound to now.
     *
     * @param acting - The verified caller.
     * @param caller - The caller's credential.
     * @param listed - The candidate lines (every origin but `cook`), each with the ingredient it became.
     * @param deadline - The request's deadline, when it has one.
     * @returns Line id → bound food and flag. A line whose binding no longer names a food has no entry. @sideEffect Reads.
     */
    public async flagsOf(
        acting: ActingPrincipal,
        caller: CallerToken | undefined,
        listed: readonly ListedLine[],
        deadline?: AbortSignal,
    ): Promise<ReadonlyMap<string, FlaggedRead>> {
        if (listed.length === 0) {
            return new Map();
        }

        const arms = await this.lookups.findByIds(listed.map((row) => row.foodLookupId));
        const rows = listed.flatMap((row) => {
            const arm = arms.get(row.foodLookupId);
            const bound = arm === undefined ? undefined : foodRefOf(arm);

            return bound === undefined ? [] : [{ row, bound, suggested: defaultCandidateOf(row.line) }];
        });
        const { verdicts, exhausted, budgetSpent, answers, contained } = await this.readFacts(
            acting,
            caller,
            deadline,
            {
                keys: rows.flatMap(({ row }) => (row.savedVerificationKey === null ? [] : [row.savedVerificationKey])),
                foods: rows.flatMap(({ bound, suggested }) => [bound, ...(suggested === undefined ? [] : [suggested])]),
            },
        );

        const viewOf = (ref: FoodRef): FoodRefView => {
            const answer = answers.get(foodRefKey(ref));

            return isNamed(answer) ? namedFood(answer) : { kind: ref.kind, id: ref.id, name: null };
        };

        return new Map(
            rows.map(({ row, bound, suggested }) => {
                const key = row.savedVerificationKey;
                const verdict = key === null ? undefined : verdicts.get(key);
                const review =
                    key === null ? 'notAsked' : reviewStandingOf(key, false, { exhausted, budgetSpent, contained });
                const decided = importFlagOf({
                    reading: verdict === undefined ? 'unasked' : identityReadingOf(verdict),
                    review,
                    boundFoodId: bound.id,
                    defaultFoodId: suggested?.id,
                });
                const flag: ImportFlag =
                    decided.state === 'flagged'
                        ? {
                              state: 'flagged',
                              suggestion:
                                  suggested === undefined || decided.suggestionFoodId === undefined
                                      ? null
                                      : viewOf(suggested),
                          }
                        : { state: decided.state };

                return [row.line.id, { bound: viewOf(bound), flag }] as const;
            }),
        );
    }

    /** The shared read side of a match (`readMatchFacts`): bounded by the deadline, each unreadable fact read as absent. */
    private readFacts(
        acting: ActingPrincipal,
        caller: CallerToken | undefined,
        deadline: AbortSignal | undefined,
        ask: { readonly keys: readonly string[]; readonly foods: readonly FoodRef[] },
    ): ReturnType<typeof readMatchFacts> {
        return readMatchFacts(
            { verdicts: this.verdicts, refs: this.refs, logger: this.logger },
            { acting, caller, deadline, subject: 'import', ...ask },
        );
    }
}
