/**
 * @module @commise/features-recipes/__fixtures__ — the progressive food search's frames as tests build them (ADR-0055
 * point 9), and the frame sequences every tier of the list feeds one frame at a time: the list model's table, and both
 * platforms' component tests, read the same rows (`docs/design/rowEditorOpenDecisions.md`, S7 list contract,
 * "Success measure").
 */
import {
    EMPTY_PROGRESSIVE_ANSWER,
    withProgressiveFrame,
    type AuthoredFoodSearchResultView,
    type CatalogSearchResultView,
    type ProgressiveAnswer,
    type ProgressiveFrame,
    type ProgressiveSourceFrame,
    type RemoteFoodView,
} from '@kitchensink/food-service-client';

/** One of the cook's own foods, as the database frame carries it. */
export const authoredResult = (id: string, name: string | null = `my ${id}`): AuthoredFoodSearchResultView => ({
    id,
    name,
    score: 0.5,
});

/** A catalog food, as the database frame carries it. */
export const catalogResult = (id: string, name: string | null = `food ${id}`): CatalogSearchResultView => ({
    id,
    name,
    score: 0.5,
});

/** A remote food, as a source frame carries it. */
export const remoteItem = (name: string, reference = `ref:${name}`): RemoteFoodView => ({ name, reference });

/** What a database frame's group holds: its foods, or `'unavailable'`. */
type GroupContent<R> = readonly R[] | 'unavailable';

/** The database frame: each group answered with its foods, or unavailable. */
export const databaseFrame = (
    groups: {
        readonly authored?: GroupContent<AuthoredFoodSearchResultView>;
        readonly catalog?: GroupContent<CatalogSearchResultView>;
    } = {},
): ProgressiveFrame => {
    const authored = groups.authored ?? [];
    const catalog = groups.catalog ?? [];

    return {
        type: 'database',
        authored:
            authored === 'unavailable' ? { outcome: 'unavailable' } : { outcome: 'answered', results: [...authored] },
        catalog:
            catalog === 'unavailable' ? { outcome: 'unavailable' } : { outcome: 'answered', results: [...catalog] },
    };
};

/** A source's answer: its foods, which may be none. */
export const sourceAnswered = (source: string, ...items: RemoteFoodView[]): ProgressiveSourceFrame => ({
    type: 'source',
    source,
    outcome: 'answered',
    items,
});

/** A source that was busy until `retryAt`. */
export const sourceBusy = (source: string, retryAt = 0): ProgressiveSourceFrame => ({
    type: 'source',
    source,
    outcome: 'busy',
    retryAt,
});

/** A source the cook's own limit skipped, until `retryAt`. */
export const sourceLimited = (source: string, retryAt: number): ProgressiveSourceFrame => ({
    type: 'source',
    source,
    outcome: 'limited',
    retryAt,
});

/** A source that did not answer in time. */
export const sourceUnavailable = (source: string): ProgressiveSourceFrame => ({
    type: 'source',
    source,
    outcome: 'unavailable',
});

/** The last frame. */
export const COMPLETE_FRAME: ProgressiveFrame = { type: 'complete' };

/** The answer `frames` fold to, as the client's reducer folds them. */
export const answerOf = (...frames: readonly ProgressiveFrame[]): ProgressiveAnswer =>
    frames.reduce(withProgressiveFrame, EMPTY_PROGRESSIVE_ANSWER);

/** A sequence of frames an answer arrives in, named for what it exercises. */
export interface FrameSequence {
    readonly name: string;
    readonly frames: readonly ProgressiveFrame[];
}

/**
 * The sequences the "nothing moves" property is checked over (S7 list contract P2): fed one frame at a time, every
 * option already shown keeps its index and its key.
 */
export const FRAME_SEQUENCES: readonly FrameSequence[] = [
    {
        name: 'both database groups, then two sources with foods, then complete',
        frames: [
            databaseFrame({ authored: [authoredResult('a1')], catalog: [catalogResult('c1'), catalogResult('c2')] }),
            sourceAnswered('usda', remoteItem('Egg, duck'), remoteItem('Egg, goose')),
            sourceAnswered('cnf', remoteItem('Egg, quail')),
            COMPLETE_FRAME,
        ],
    },
    {
        name: 'a database group unavailable, a busy source, then a source with foods',
        frames: [
            databaseFrame({ authored: 'unavailable', catalog: [catalogResult('c1')] }),
            sourceBusy('cnf', 60_000),
            sourceAnswered('usda', remoteItem('Egg, duck')),
            COMPLETE_FRAME,
        ],
    },
    {
        name: 'no database food, then a source with foods, and no complete',
        frames: [databaseFrame(), sourceAnswered('usda', remoteItem('Garbanzo beans'))],
    },
];
