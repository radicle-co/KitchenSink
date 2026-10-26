/**
 * @module @commise/features-recipes/editor — WHEN the paste host asks recipe-service to match the foods a job has
 * parsed (ADR-0071 section 4/9: `POST /matches` is idempotent and is called from the poll loop "when newly parsed lines
 * appear"). The job view is the only change notice there is, so demand is read off it: a parsed food with no match yet
 * is DEMAND; a food that already has one (even `checking`) is not, because the poll refreshes it and asking again would
 * be a second request for nothing.
 *
 * The host asks only when the set of unmatched foods GAINS a member, and never while a request is in flight: the next
 * poll asks for whatever that request missed. A set that only shrinks (matches arrived) or stays the same (the same job
 * re-read) raises nothing, so a poll cannot become a request storm.
 *
 * Pure and platform-agnostic.
 *
 * @pattern Specification — `shouldRequestMatches` is the one predicate that decides a match request
 */
import type { ParseJobResponse } from '@kitchensink/schema-recipe';

/** One parsed food of a job: where it sits, and the key every layer of the paste overlay names it by. */
export interface UnmatchedFood {
    /** `${lineIndex}:${foodIndex}`: the food's key among the paste's match lines (`foodKeyOf`). */
    readonly key: string;
    readonly lineIndex: number;
    readonly foodIndex: number;
}

/**
 * The key of a job's food: one authority for the string the matched lines, the session and the demand all use. Pure.
 *
 * @param lineIndex - The line's index in the job.
 * @param foodIndex - The food's index in the line's proposal.
 * @returns `${lineIndex}:${foodIndex}`.
 */
export function foodKeyOf(lineIndex: number, foodIndex: number): string {
    return `${lineIndex}:${foodIndex}`;
}

/**
 * The parsed foods that have no match yet, in paste order. A line with no proposal (pending, withdrawn, unparseable,
 * failed) has no food to match. Pure.
 *
 * @param job - The job as last read.
 * @returns The unmatched foods.
 */
export function unmatchedFoodRefsOf(job: ParseJobResponse): readonly UnmatchedFood[] {
    return job.lines.flatMap((line) =>
        (line.proposal?.foods ?? []).flatMap((food, foodIndex) =>
            food.match == null
                ? [{ key: foodKeyOf(line.lineIndex, foodIndex), lineIndex: line.lineIndex, foodIndex }]
                : [],
        ),
    );
}

/**
 * Whether to send a match request now. Pure.
 *
 * @param lastRequested - The keys the last request covered.
 * @param unmatched - The foods with no match now (`unmatchedFoodRefsOf`).
 * @param inFlight - Whether a request is in flight.
 * @returns `true` only when nothing is in flight and the unmatched set holds a food the last request did not cover.
 */
export function shouldRequestMatches(
    lastRequested: ReadonlySet<string>,
    unmatched: readonly UnmatchedFood[],
    inFlight: boolean,
): boolean {
    return !inFlight && unmatched.some((food) => !lastRequested.has(food.key));
}
