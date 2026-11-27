/**
 * `canTransition` and `nextState`: the pure reading of TRANSITIONS (5.1 to 5.4). Both read only the enforced table, so
 * an edge that is planned, or absent, is forbidden. Each guard is a named predicate over the facts, written once here.
 *
 * Facts left out of a request read false, so a caller that forgot one is refused and never allowed (fail closed).
 *
 * @pattern Specification for the guards, over the table-driven state machine in `transitions.ts`.
 */
import { REFUSAL, refusalOf, type Refusal, type RefusalFacts } from './refusalOf.js';
import { SOURCE_LOCK, type Actor, type Axis, type AxisStates } from './recipeStateValues.js';
import { TRANSITIONS, type GuardName, type Move, type TransitionRow } from './transitions.js';

/** Everything a guard can read. Every fact but the actor and the source is optional, and absent reads false. */
export interface TransitionFacts {
    readonly actor: Actor;
    /** The source facts `refusalOf` judges. */
    readonly source: RefusalFacts;
    /** The publish requirements are met (`REFUSAL_PUBLISH_REQUIREMENTS` is not due). */
    readonly requirementsMet?: boolean;
    /** The cook holds fewer private recipes than their limit (ADR-0073). */
    readonly privateSlotFree?: boolean;
    /** The cook accepted the Publish sheet. */
    readonly publishSheetAccepted?: boolean;
    /** The origin answer forces private, or a staff correction does (`FORCE_PRIVATE`). */
    readonly forcesPrivate?: boolean;
    /** The cook elected to donate on erasure. */
    readonly donationElected?: boolean;
    /** What `sourceLockOf` answers. */
    readonly sourceLock?: (typeof SOURCE_LOCK)[keyof typeof SOURCE_LOCK];
    /** `SOURCE_CONFIRMED`. */
    readonly sourceConfirmed?: boolean;
    /** The answer carries a link or citation. */
    readonly citationGiven?: boolean;
    /** The recipe is private already. */
    readonly alreadyPrivate?: boolean;
    /** The actor holds the grant `recipes:import:public`. */
    readonly curatorGrant?: boolean;
    /** The actor holds the grant `recipes:source:correct`. */
    readonly staffGrant?: boolean;
    /** The staff's new answer can open Public. */
    readonly newAnswerCanOpenPublic?: boolean;
}

type GuardFn = (facts: TransitionFacts, move: Move<Axis>) => boolean;

const isPublicTarget = (move: Move<Axis>): boolean => move.to === 'PPu' || move.to === 'DPu';

const isPrivateTarget = (move: Move<Axis>): boolean => move.to === 'PPr' || move.to === 'DPr';

const GUARDS: Readonly<Record<GuardName, GuardFn>> = {
    none: () => true,
    publishSheetAccepted: (facts) => facts.publishSheetAccepted === true,
    publishable: (facts, move) =>
        facts.requirementsMet === true &&
        facts.publishSheetAccepted === true &&
        (!isPrivateTarget(move) || facts.privateSlotFree === true),
    privateSlotFree: (facts) => facts.privateSlotFree === true,
    forcesPrivate: (facts) => facts.forcesPrivate === true,
    donationElected: (facts) => facts.donationElected === true,
    sourceLockOpen: (facts) => facts.sourceLock === SOURCE_LOCK.SOURCE_LOCK_OPEN,
    curatorGrant: (facts) => facts.curatorGrant === true,
    downgradeAllowed: (facts) =>
        facts.sourceConfirmed === true &&
        facts.citationGiven === true &&
        (facts.alreadyPrivate === true || facts.privateSlotFree === true),
    staffCorrection: (facts) => facts.staffGrant === true && facts.sourceConfirmed === true,
    staffCorrectionSetsHold: (facts) => facts.staffGrant === true && facts.newAnswerCanOpenPublic === true,
};

/** What `nextState` answers: the new state, or the refusal. `REFUSAL_NONE` means the edge is forbidden with no named reason. */
export type NextState<A extends Axis> =
    { readonly ok: true; readonly to: AxisStates[A] } | { readonly ok: false; readonly refusal: Refusal };

function rowFor<A extends Axis>(
    axis: A,
    from: AxisStates[A],
    event: string,
): { row: TransitionRow<A>; move: Move<A> } | undefined {
    for (const candidate of TRANSITIONS) {
        if (candidate.axis !== axis || candidate.event !== event) {
            continue;
        }

        const move = (candidate.moves as readonly Move<A>[]).find((entry) => entry.from === from);

        if (move !== undefined) {
            return { row: candidate as TransitionRow<A>, move };
        }
    }

    return undefined;
}

/**
 * Where an event takes a recipe, or why it does not.
 *
 * @param axis - The axis the event moves.
 * @param from - The state it is in.
 * @param event - The event.
 * @param facts - The facts the guards read.
 * @returns The new state, or the refusal. A forbidden edge, or a guard that fails with no named reason, is `REFUSAL_NONE`.
 *   A refused `MAKE_PUBLIC` carries the refusal `refusalOf` named. Pure.
 */
export function nextState<A extends Axis>(
    axis: A,
    from: AxisStates[A],
    event: string,
    facts: TransitionFacts,
): NextState<A> {
    const found = rowFor(axis, from, event);

    if (found === undefined || !found.row.actors.includes(facts.actor)) {
        return { ok: false, refusal: REFUSAL.REFUSAL_NONE };
    }

    // ⛔ The one rule for every edge that leaves a recipe public (5.1: any edge to PPu or DPu while a refusal holds is forbidden).
    // It sits here and not in a guard, so a new edge into Public cannot forget it.
    if (axis === 'lifecycleAudience' && isPublicTarget(found.move)) {
        const refusal = refusalOf(facts.source);

        if (refusal !== REFUSAL.REFUSAL_NONE) {
            return { ok: false, refusal };
        }
    }

    if (!GUARDS[found.row.guard](facts, found.move)) {
        return { ok: false, refusal: REFUSAL.REFUSAL_NONE };
    }

    return { ok: true, to: found.move.to };
}

/**
 * Whether an event is allowed. Pure.
 *
 * @param axis - The axis the event moves.
 * @param from - The state it is in.
 * @param event - The event.
 * @param facts - The facts the guards read.
 * @returns True when TRANSITIONS has the edge, the actor may take it and its guard holds.
 */
export function canTransition<A extends Axis>(
    axis: A,
    from: AxisStates[A],
    event: string,
    facts: TransitionFacts,
): boolean {
    return nextState(axis, from, event, facts).ok;
}
