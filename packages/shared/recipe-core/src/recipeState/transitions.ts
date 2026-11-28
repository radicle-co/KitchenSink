/**
 * TRANSITIONS: the edges the recipe state model enforces on main (5.1 to 5.4), as a table. `nextState` and
 * `canTransition` read only this table, so an edge that is not here is forbidden. A planned edge is in
 * `plannedTransitions.ts` until the change that enforces it moves it here (ADR-0103).
 *
 * A row is one event with its actors, its named guard and every move it allows. The doc's tables (and a mermaid diagram)
 * are generated from the rows by `packages/tools/recipeStateDoc`.
 *
 * @pattern State Machine as a transition table (Table-Driven), with Specification for the guards in `nextState.ts`. A
 *   discriminated union and an exhaustive switch meet Visitor's intent, so no library is needed.
 */
import {
    Origin,
    type Actor,
    type Axis,
    type AxisStates,
    type LifecycleAudienceState,
    type OriginName,
} from './recipeStateValues.js';

/** The named predicates a row's guard can be. `nextState.ts` holds one implementation of each. */
export const GUARD_NAMES = [
    'none',
    'publishSheetAccepted',
    'publishable',
    'privateSlotFree',
    'donationElected',
    'sourceLockOpen',
    'curatorGrant',
    'downgradeAllowed',
    'staffCorrection',
    'staffCorrectionSetsHold',
] as const;

/** One guard. */
export type GuardName = (typeof GUARD_NAMES)[number];

/** One move of one row. `from` and `to` are states of the row's axis. */
export interface Move<A extends Axis> {
    readonly from: AxisStates[A];
    readonly to: AxisStates[A];
}

/** One row of the table: an event and everything it may do. */
export interface TransitionRow<A extends Axis = Axis> {
    /** Unique. The doc generator keys its prose on it. */
    readonly id: string;
    /** The document row that covers this row, when one document row covers several. Defaults to the id. */
    readonly group?: string;
    readonly axis: A;
    /** The event `nextState` takes. Unique per axis and from-state. */
    readonly event: string;
    /** What the document calls the event, when one document row covers several events. */
    readonly docEvent?: string;
    readonly actors: readonly Actor[];
    readonly guard: GuardName;
    readonly moves: readonly Move<A>[];
}

function row<A extends Axis>(entry: TransitionRow<A>): TransitionRow<A> {
    return entry;
}

const LIVE: readonly LifecycleAudienceState[] = ['DPr', 'DPu', 'PPr', 'PPu'];

const ANSWERS = [
    ['ANSWER_OWN', 'ORIGIN_OWN'],
    ['ANSWER_WEB_PAGE', 'ORIGIN_WEB_PAGE'],
    ['ANSWER_BOOK', 'ORIGIN_BOOK'],
    ['ANSWER_PAID_SITE', 'ORIGIN_PAID_SITE'],
    ['ANSWER_PERSON', 'ORIGIN_PERSON'],
] as const;

/** Every origin a cook or staff can reach or leave: `ORIGIN_COMMISE_WRITTEN` exists only by creation (5.2). */
const EDITABLE_ORIGINS = (Object.keys(Origin) as OriginName[]).filter((name) => name !== 'ORIGIN_COMMISE_WRITTEN');

/** The origins a cook's answer can leave. Public domain is a curator's declaration, so no answer starts there. */
const ANSWER_FROM = EDITABLE_ORIGINS.filter((name) => name !== 'ORIGIN_PUBLIC_DOMAIN');

/** The enforced edges, in the order the document lists them. */
export const TRANSITIONS: readonly TransitionRow[] = [
    row({
        id: 'MAKE_PUBLIC_DRAFT',
        axis: 'lifecycleAudience',
        event: 'MAKE_PUBLIC',
        actors: ['cook'],
        guard: 'none',
        moves: [{ from: 'DPr', to: 'DPu' }],
    }),
    row({
        id: 'MAKE_PRIVATE_DRAFT',
        axis: 'lifecycleAudience',
        event: 'MAKE_PRIVATE',
        actors: ['cook'],
        guard: 'none',
        moves: [{ from: 'DPu', to: 'DPr' }],
    }),
    row({
        id: 'PUBLISH',
        axis: 'lifecycleAudience',
        event: 'PUBLISH',
        actors: ['cook'],
        guard: 'publishable',
        moves: [
            { from: 'DPr', to: 'PPr' },
            { from: 'DPu', to: 'PPu' },
        ],
    }),
    row({
        id: 'MAKE_PUBLIC_PUBLISHED',
        axis: 'lifecycleAudience',
        event: 'MAKE_PUBLIC',
        actors: ['cook'],
        guard: 'publishSheetAccepted',
        moves: [{ from: 'PPr', to: 'PPu' }],
    }),
    row({
        id: 'MAKE_PRIVATE_PUBLISHED',
        axis: 'lifecycleAudience',
        event: 'MAKE_PRIVATE',
        actors: ['cook'],
        guard: 'privateSlotFree',
        moves: [{ from: 'PPu', to: 'PPr' }],
    }),
    row({
        id: 'UNPUBLISH',
        axis: 'lifecycleAudience',
        event: 'UNPUBLISH',
        actors: ['cook'],
        guard: 'none',
        moves: [
            { from: 'PPu', to: 'DPu' },
            { from: 'PPr', to: 'DPr' },
        ],
    }),
    row({
        id: 'ERASE_DONATE',
        axis: 'lifecycleAudience',
        event: 'ERASE_DONATE',
        actors: ['system'],
        guard: 'donationElected',
        moves: [
            { from: 'DPr', to: 'PPu' },
            { from: 'DPu', to: 'PPu' },
            { from: 'PPr', to: 'PPu' },
        ],
    }),
    row({
        id: 'DELETE',
        axis: 'lifecycleAudience',
        event: 'DELETE',
        actors: ['cook', 'erasure'],
        guard: 'none',
        moves: LIVE.map((from) => ({ from, to: 'Del' as const })),
    }),
    // One row per answer event, because an event names one target. The document shows them as the one row `ANSWER_*`.
    ...ANSWERS.map(([event, to]) =>
        row({
            id: event,
            group: 'ANSWER',
            axis: 'origin',
            event,
            actors: ['cook'],
            guard: 'sourceLockOpen',
            moves: ANSWER_FROM.filter((from) => from !== to).map((from) => ({ from, to })),
        }),
    ),
    row({
        id: 'PASTE_DETECTED',
        axis: 'origin',
        event: 'PASTE_DETECTED',
        actors: ['system'],
        guard: 'none',
        moves: [{ from: 'ORIGIN_UNSTATED', to: 'ORIGIN_UNSTATED' }],
    }),
    row({
        id: 'CURATOR_DECLARE',
        axis: 'origin',
        event: 'CURATOR_DECLARE',
        actors: ['curator'],
        guard: 'curatorGrant',
        moves: [{ from: 'ORIGIN_UNSTATED', to: 'ORIGIN_PUBLIC_DOMAIN' }],
    }),
    // Two rows, because an event names one target. The document shows both as `DOWNGRADE`.
    row({
        id: 'DOWNGRADE_BOOK',
        group: 'DOWNGRADE',
        axis: 'origin',
        event: 'DOWNGRADE_BOOK',
        docEvent: 'DOWNGRADE',
        actors: ['cook'],
        guard: 'downgradeAllowed',
        moves: [{ from: 'ORIGIN_OWN', to: 'ORIGIN_BOOK' }],
    }),
    row({
        id: 'DOWNGRADE_PAID_SITE',
        group: 'DOWNGRADE',
        axis: 'origin',
        event: 'DOWNGRADE_PAID_SITE',
        docEvent: 'DOWNGRADE',
        actors: ['cook'],
        guard: 'downgradeAllowed',
        moves: [{ from: 'ORIGIN_OWN', to: 'ORIGIN_PAID_SITE' }],
    }),
    // One row per target the staff's answer can name, because an event names one target. The document shows them as `STAFF_CORRECT`.
    ...ANSWERS.map(([, to]) =>
        row({
            id: `STAFF_CORRECT_TO_${to.replace('ORIGIN_', '')}`,
            group: 'STAFF_CORRECT',
            axis: 'origin',
            event: `STAFF_CORRECT_TO_${to.replace('ORIGIN_', '')}`,
            docEvent: 'STAFF_CORRECT',
            actors: ['staff'],
            guard: 'staffCorrection',
            moves: EDITABLE_ORIGINS.filter((from) => from !== to).map((from) => ({ from, to })),
        }),
    ),
    row({
        id: 'CONFIRM_SOURCE',
        axis: 'sourceConfirmation',
        event: 'CONFIRM_SOURCE',
        actors: ['cook', 'system', 'staff'],
        guard: 'none',
        moves: [{ from: 'SOURCE_UNCONFIRMED', to: 'SOURCE_CONFIRMED' }],
    }),
    row({
        id: 'SET_SOURCE_CORRECTED_HOLD',
        group: 'HOLD_SET_SOURCE_CORRECTED',
        axis: 'holdSourceCorrected',
        event: 'STAFF_CORRECT',
        actors: ['staff'],
        guard: 'staffCorrectionSetsHold',
        moves: [{ from: 'unset', to: 'set' }],
    }),
];
