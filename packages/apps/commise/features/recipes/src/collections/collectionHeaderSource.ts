/**
 * @module @commise/features-recipes/collections — the "copied from" facts of a collection, as the header's optional
 * props.
 *
 * The header declares each as an optional prop, and under `exactOptionalPropertyTypes` a key may be absent but not
 * `undefined`. Spreading the five conditionally at the call site put five ternaries in the composition's
 * cognitive-complexity budget; this keeps the rule — omit what the collection does not state — in one pure place.
 */
import type { CollectionHeaderProps } from './detailModel.js';

/** The header props that describe where a copy came from and when it last pulled. */
export type CollectionHeaderSourceProps = Pick<
    CollectionHeaderProps,
    'sourceCollectionName' | 'sourceOwnerDisplayName' | 'sourceOwnerUsername' | 'sourceCollectionId' | 'lastPulledAt'
>;

/**
 * Pick the "copied from" facts a collection states.
 *
 * @param collection - Any object carrying the five optional facts.
 * @returns An object holding only the facts that are not `undefined`. Pure.
 */
export function headerSourceProps(collection: {
    readonly sourceCollectionName?: string | undefined;
    readonly sourceOwnerDisplayName?: string | undefined;
    readonly sourceOwnerUsername?: string | undefined;
    readonly sourceCollectionId?: string | undefined;
    readonly lastPulledAt?: string | undefined;
}): CollectionHeaderSourceProps {
    const { sourceCollectionName, sourceOwnerDisplayName, sourceOwnerUsername, sourceCollectionId, lastPulledAt } =
        collection;

    return {
        ...(sourceCollectionName === undefined ? {} : { sourceCollectionName }),
        ...(sourceOwnerDisplayName === undefined ? {} : { sourceOwnerDisplayName }),
        ...(sourceOwnerUsername === undefined ? {} : { sourceOwnerUsername }),
        ...(sourceCollectionId === undefined ? {} : { sourceCollectionId }),
        ...(lastPulledAt === undefined ? {} : { lastPulledAt }),
    };
}
