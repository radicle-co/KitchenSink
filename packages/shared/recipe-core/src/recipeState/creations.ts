/**
 * CREATIONS: how a recipe comes into being (5.7). A creation is not an edge of any graph, so it has its own table. The
 * writers guard (PR 4) takes its allowlist of events from here and from TRANSITIONS.
 *
 * @pattern Table-Driven rows, keyed by creation id. The document's wording of each cell is in the doc generator.
 */
import { type Actor, type LifecycleAudienceState, type OriginName } from './recipeStateValues.js';

/** How a creation decides the origin: a fixed one, or one taken from a fact. */
export type CreationOrigin = OriginName | 'fromSheetAnswer' | 'fromItemStatement' | 'fromSource';

/** One way a recipe is created. */
export interface Creation {
    readonly id: string;
    readonly actor: Actor | 'another cook' | '003B job';
    /** The lifecycle and audience pairs it can create. */
    readonly states: readonly LifecycleAudienceState[];
    readonly origin: CreationOrigin;
    readonly confirmation: 'unconfirmed' | 'confirmed' | 'asTheRouteSets';
    /** Whether the creation copies `HOLD_SOURCE_CORRECTED` from its source at insert. */
    readonly copiesSourceCorrectedHold: boolean;
    /** Whether the new recipe carries a clone link. */
    readonly cloneLink: boolean;
}

export const CREATIONS: readonly Creation[] = [
    {
        id: 'CREATE_DRAFT',
        actor: 'cook',
        states: ['DPr'],
        origin: 'ORIGIN_UNSTATED',
        confirmation: 'unconfirmed',
        copiesSourceCorrectedHold: false,
        cloneLink: false,
    },
    {
        id: 'CREATE_PUBLISHED',
        actor: 'cook',
        states: ['PPr', 'PPu'],
        origin: 'fromSheetAnswer',
        confirmation: 'confirmed',
        copiesSourceCorrectedHold: false,
        cloneLink: false,
    },
    {
        id: 'IMPORT_SAVE',
        actor: 'import',
        states: ['PPr', 'PPu'],
        origin: 'fromItemStatement',
        confirmation: 'confirmed',
        copiesSourceCorrectedHold: false,
        cloneLink: false,
    },
    {
        id: 'CURATOR_IMPORT',
        actor: 'curator',
        states: ['PPu'],
        origin: 'ORIGIN_PUBLIC_DOMAIN',
        confirmation: 'confirmed',
        copiesSourceCorrectedHold: false,
        cloneLink: false,
    },
    {
        id: 'CLONE',
        actor: 'another cook',
        states: ['PPr', 'DPr'],
        origin: 'fromSource',
        confirmation: 'asTheRouteSets',
        copiesSourceCorrectedHold: true,
        cloneLink: true,
    },
    {
        id: 'CLONE_OF_PUBLIC_VERSION',
        actor: 'another cook',
        states: ['DPr'],
        origin: 'fromSource',
        confirmation: 'asTheRouteSets',
        copiesSourceCorrectedHold: true,
        cloneLink: true,
    },
    {
        id: 'PUBLIC_VERSION_PUBLISH',
        actor: '003B job',
        states: ['PPu'],
        origin: 'ORIGIN_COMMISE_WRITTEN',
        confirmation: 'confirmed',
        copiesSourceCorrectedHold: false,
        cloneLink: false,
    },
];
