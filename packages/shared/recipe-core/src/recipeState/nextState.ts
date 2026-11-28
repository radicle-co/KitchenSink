/**
 * `canTransition` and `nextState`: the pure reading of TRANSITIONS (5.1 to 5.4). Both read only the enforced table, so
 * an edge that is planned, or absent, is forbidden. Each guard is a named predicate over the facts, written once here.
 *
 * Facts left out of a request read false, so a caller that forgot one is refused and never allowed (fail closed).
 *
 * @pattern Specification for the guards, over the table-driven state machine in `transitions.ts`.
 */
import { REFUSAL, refusalOf, type Refusal, type ServerRefusalFacts } from './refusalOf.js';
import { SOURCE_LOCK, type Actor, type Axis, type AxisStates } from './recipeStateValues.js';
import type { SourceLock } from '../sourceRules.js';
import { TRANSITIONS, type GuardName, type Move, type TransitionRow } from './transitions.js';

/** Everything a guard can read. Every fact but the actor and the source is optional, and absent reads false. */
export interface TransitionFacts {
    readonly actor: Actor;
    /** The source facts `refusalOf` judges. The server's, so every flag is stated and none can be forgotten. */
    readonly source: ServerRefusalFacts;
    /** The publish requirements are met (`REFUSAL_PUBLISH_REQUIREMENTS` is not due). */
    readonly requirementsMet?: boolean;
    /** The cook holds fewer private recipes than their limit (ADR-0073). */
    readonly privateSlotFree?: boolean;
    /** The cook accepted the Publish sheet. */
    readonly publishSheetAccepted?: boolean;
    /** The cook elected to donate on erasure. */
    readonly donationElected?: boolean;
    /** What `sourceLockOf` answers. */
    readonly sourceLock?: SourceLock;
    /** `SOURCE_CONFIRMED`. */
    readonly sourceConfirmed?: boolean;
    /** The answer carries a link or citation. The wire schema enforces the citation rule, so this is its result. */
    readonly citationGiven?: boolean;
    /** The recipe is private already. */
    readonly alreadyPrivate?: boolean;
    /** The actor holds the grant `recipes:import:public`. */
    readonly curatorGrant?: boolean;
    /** The actor holds the grant `recipes:source:correct`. */
    readonly staffGrant?: boolean;
    /** The staff's new answer can open Public. */
    readonly newAnswerCanOpenPublic?: boolean;
    /** Every correction row in the recipe's chain (itself and each ancestor) has a third-party answer (ADR-0106). */
    readonly correctedAnswerThirdParty?: boolean;
}

/** A refusal that names a failure. `REFUSAL_NONE` is "no refusal", so it is never a failure. */
type NamedRefusal = Exclude<Refusal, 'REFUSAL_NONE'>;

/** What a guard answers: `null` when it holds, the refusal it names, or `guard` when the model has no refusal for it. */
type GuardAnswer = null | NamedRefusal | 'guard';

type GuardFn = (facts: TransitionFacts, move: Move<Axis>) => GuardAnswer;

const isPublicTarget = (move: Move<Axis>): boolean => move.to === 'PPu' || move.to === 'DPu';

const isPrivateTarget = (move: Move<Axis>): boolean => move.to === 'PPr' || move.to === 'DPr';

const holdsOr = (holds: boolean, refusal: GuardAnswer): GuardAnswer => (holds ? null : refusal);

const GUARDS: Readonly<Record<GuardName, GuardFn>> = {
    none: () => null,
    publishSheetAccepted: (facts) =>
        holdsOr(facts.publishSheetAccepted === true, REFUSAL.REFUSAL_PUBLIC_CONFIRMATION_REQUIRED),
    publishable: (facts, move) => {
        if (facts.requirementsMet !== true) {
            return REFUSAL.REFUSAL_PUBLISH_REQUIREMENTS;
        }

        if (facts.publishSheetAccepted !== true) {
            return REFUSAL.REFUSAL_PUBLIC_CONFIRMATION_REQUIRED;
        }

        return holdsOr(!isPrivateTarget(move) || facts.privateSlotFree === true, REFUSAL.REFUSAL_NO_PRIVATE_SLOT);
    },
    privateSlotFree: (facts) => holdsOr(facts.privateSlotFree === true, REFUSAL.REFUSAL_NO_PRIVATE_SLOT),
    donationElected: (facts) => holdsOr(facts.donationElected === true, 'guard'),
    sourceLockOpen: (facts) =>
        holdsOr(facts.sourceLock === SOURCE_LOCK.SOURCE_LOCK_OPEN, REFUSAL.REFUSAL_SOURCE_LOCKED),
    curatorGrant: (facts) => holdsOr(facts.curatorGrant === true, 'guard'),
    downgradeAllowed: (facts) => {
        if (facts.sourceConfirmed !== true || facts.citationGiven !== true) {
            return 'guard';
        }

        return holdsOr(
            facts.alreadyPrivate === true || facts.privateSlotFree === true,
            REFUSAL.REFUSAL_NO_PRIVATE_SLOT,
        );
    },
    staffCorrection: (facts) => holdsOr(facts.staffGrant === true && facts.sourceConfirmed === true, 'guard'),
    staffCorrectionSetsHold: (facts) =>
        holdsOr(facts.staffGrant === true && facts.newAnswerCanOpenPublic === true, 'guard'),
    staffHoldClear: (facts) => holdsOr(facts.staffGrant === true, 'guard'),
    earnedRewriteClearsHold: (facts) => holdsOr(facts.correctedAnswerThirdParty === true, 'guard'),
};

/**
 * Runs the guard a row names. A switch, not `GUARDS[name](...)`: every call names its guard in the source, and a guard
 * added to `GuardName` without a case fails the build at `never`.
 *
 * @param name - The guard's name.
 * @param facts - The facts it reads.
 * @param move - The move it guards.
 * @returns What the guard answers. Pure.
 */
function runGuard(name: GuardName, facts: TransitionFacts, move: Move<Axis>): GuardAnswer {
    switch (name) {
        case 'none':
            return GUARDS.none(facts, move);
        case 'publishSheetAccepted':
            return GUARDS.publishSheetAccepted(facts, move);
        case 'publishable':
            return GUARDS.publishable(facts, move);
        case 'privateSlotFree':
            return GUARDS.privateSlotFree(facts, move);
        case 'donationElected':
            return GUARDS.donationElected(facts, move);
        case 'sourceLockOpen':
            return GUARDS.sourceLockOpen(facts, move);
        case 'curatorGrant':
            return GUARDS.curatorGrant(facts, move);
        case 'downgradeAllowed':
            return GUARDS.downgradeAllowed(facts, move);
        case 'staffCorrection':
            return GUARDS.staffCorrection(facts, move);
        case 'staffCorrectionSetsHold':
            return GUARDS.staffCorrectionSetsHold(facts, move);
        case 'staffHoldClear':
            return GUARDS.staffHoldClear(facts, move);
        case 'earnedRewriteClearsHold':
            return GUARDS.earnedRewriteClearsHold(facts, move);
        default:
            return name satisfies never;
    }
}

/**
 * What `nextState` answers: the new state, or why not. A failure names a refusal of the model, or says it was the edge
 * (`noEdge`), the actor (`actor`) or a guard the model has no refusal for (`guard`).
 */
export type NextState<A extends Axis> =
    | { readonly ok: true; readonly to: AxisStates[A] }
    | { readonly ok: false; readonly refusal: NamedRefusal }
    | { readonly ok: false; readonly cause: 'noEdge' | 'actor' | 'guard' };

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
 * @returns The new state, or the refusal or cause. An edge into Public is refused with the refusal `refusalOf` names before
 *   any guard is asked. Pure.
 */
export function nextState<A extends Axis>(
    axis: A,
    from: AxisStates[A],
    event: string,
    facts: TransitionFacts,
): NextState<A> {
    const found = rowFor(axis, from, event);

    if (found === undefined) {
        return { ok: false, cause: 'noEdge' };
    }

    if (!found.row.actors.includes(facts.actor)) {
        return { ok: false, cause: 'actor' };
    }

    // ⛔ The one rule for every edge that leaves a recipe public (5.1: any edge to PPu or DPu while a refusal holds is forbidden).
    // It sits here and not in a guard, so a new edge into Public cannot forget it.
    if (axis === 'lifecycleAudience' && isPublicTarget(found.move)) {
        const refusal = refusalOf(facts.source);

        if (refusal !== REFUSAL.REFUSAL_NONE) {
            return { ok: false, refusal };
        }
    }

    const answer = runGuard(found.row.guard, facts, found.move);

    if (answer === null) {
        return { ok: true, to: found.move.to };
    }

    return answer === 'guard' ? { ok: false, cause: 'guard' } : { ok: false, refusal: answer };
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
