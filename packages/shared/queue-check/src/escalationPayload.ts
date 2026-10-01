/**
 * THE escalation payload (plan U11, R28/R31) — what a backstop is allowed to say about stuck work.
 *
 * ⛔ IT IS A CLOSED TYPE OF IDENTIFIERS AND NUMBERS, and that is the whole design. A backstop reads rows the
 * user wrote: recipe lines, ingredient phrases, display names, food names. Every one of those is content this
 * repository takes care never to copy into a place erasure cannot reach — and a Sentry event is exactly such
 * a place. So the payload has NOWHERE TO PUT TEXT: there is no `message`, no `detail`, no `sample`, no
 * `Record<string, unknown>` escape hatch. A future contributor who wants to include "just the line that
 * failed" has to change this type, in a diff a reviewer sees, rather than adding a field to an open bag.
 *
 * ⚠️ Identifiers ARE permitted, and the distinction is deliberate: a food id, a job id or a user ULID is
 * opaque and resolvable only against a database an erasure has already swept. The words a person typed are
 * not. `queueName` and `condition` come from closed vocabularies for the same reason.
 */

/** What a backstop concluded about a class of owed work. */
export type OwedCondition =
    /** Work is behind, but the transport is moving — it is late, not lost. */
    | 'delayed'
    /** Work is owed and nothing is carrying it: no message, no depth, nobody coming. */
    | 'lost'
    /** Work reached its attempt allowance and stopped trying. */
    | 'exhausted'
    /** Work landed on a dead-letter queue. */
    | 'dead-lettered'
    /** Work is claimed but the claim has outlived any plausible run. */
    | 'stuck';

/**
 * One escalation.
 *
 * ⛔ Every field is an identifier, an enum member or a NUMBER. Read the module docstring before adding one.
 */
export interface EscalationPayload {
    /** The service raising it, e.g. `recipe-workers`. A deploy identifier, never user input. */
    readonly service: string;
    /** The deploy stage — `prod`, `sandbox`, `pr-91`. */
    readonly stage: string;
    /** The queue or work class this concerns, from the service's own closed vocabulary. */
    readonly queueName: string;
    /** What was concluded. */
    readonly condition: OwedCondition;
    /** How many units of work are in this condition. A COUNT — never the units themselves. */
    readonly owedCount: number;
    /** Age of the oldest owed unit, in seconds. */
    readonly oldestOwedSeconds: number;
    /** Messages visible on the transport when the check ran. */
    readonly transportVisible: number;
    /** Messages in flight on the transport when the check ran. */
    readonly transportInFlight: number;
    /** Messages on the dead-letter queue when the check ran. */
    readonly transportDeadLettered: number;
}

/**
 * ⛔ COMPILE-TIME PROOF that {@link EscalationPayload} has no ESCAPE HATCH.
 *
 * An index signature — `[key: string]: unknown`, `Record<string, unknown>`, an `extends` of something that
 * has one — is the change that would quietly reopen this type to arbitrary content, because it needs no new
 * named field for a reviewer to notice. `string extends keyof T` is true exactly when such a signature
 * exists, so this alias resolves to `never` and the assignment below stops compiling.
 *
 * ⚠️ WHAT IT DOES NOT PROVE, stated so nobody reads more into it: a NAMED `sourceLine: string` is
 * structurally indistinguishable from `queueName: string`, and no type can tell an identifier from a recipe.
 * That one is caught by review, which is precisely why the payload is a closed interface rather than an open
 * bag — a named field is a diff someone sees.
 */
type AssertTrue<T extends true> = T;

/** Resolves only while {@link EscalationPayload} has no index signature. Exported so it is not dead code. */
export type PayloadIsClosed = AssertTrue<string extends keyof EscalationPayload ? false : true>;

/**
 * How severely an escalation reads.
 *
 * ⛔ `delayed` IS THE ONE CONDITION THAT IS NOT A FAULT — "slow is not lost". Work behind a moving queue is
 * late, and paging on late work is how a reader learns to ignore the channel. Every other condition means
 * something has stopped, so every other condition is an error.
 *
 * ⚠️ Derived here rather than at each backstop, because three services grading the same condition three ways
 * is a difference an operator would read as a difference in the WORK.
 *
 * @param payload - The escalation.
 * @returns The Sentry level. Pure.
 */
export function escalationLevel(payload: EscalationPayload): 'error' | 'warning' {
    return payload.condition === 'delayed' ? 'warning' : 'error';
}

/**
 * The one line of an escalation a human reads as prose.
 *
 * ⛔ IT IS BUILT FROM TWO CLOSED VOCABULARIES AND NOTHING ELSE. Being the only prose field, it is the obvious
 * place for somebody to append "and here is the line that failed" — so it is derived from the payload, whose
 * type has nowhere to hold such a thing, rather than composed by hand at each call site.
 *
 * @param payload - The escalation.
 * @returns The title. Pure.
 */
export function escalationTitle(payload: EscalationPayload): string {
    return `${payload.queueName}: ${payload.condition}`;
}
