'use client';

/**
 * @module @commise/features-recipes/collections — web collection member row (W5 Task 9, C3).
 *
 * One member recipe in a collection's detail view, COMPOSED from the shared {@link RecipeCard} compound
 * parts (P7 — the collection row is another `RecipeCard` surface) rather than a bespoke row: `RecipeCard.Title`
 * / `.Meta` / `.Badges` already render the title, calories, the version badge past v1, and the
 * visibility/draft badge — this row adds ONLY what the card does not: a read-only source-indicator
 * (owner-added/protected vs from-source/will-sync, from `member.addedVia`) and the `by @handle` attribution.
 *
 * `RecipeCard` is rendered WITHOUT `onSelect` (a non-interactive `<article>`), and the select target and the
 * Remove control are composed as SIBLING buttons inside it — never nested — so activating Remove can never
 * also fire `onSelect` (the double-fire guard). This mirrors `RecipeDiscoveryCard`,
 * the sibling surface that already established the "card without onSelect + custom sibling actions" pattern
 * for a card with more than one action.
 */
import { useMessages } from '@commise/i18n/react';
import { RecipeCollectionAddedVia } from '@kitchensink/recipe-core';
import type { FC } from 'react';

import { RecipeCard } from '../card/index.js';
import { toRecipeCardModel } from '../card/model.js';
import { fillTemplate } from '../list/model.js';
import { collectionMessages } from './messages.js';
import type { CollectionMemberRowProps } from './model.js';

/**
 * A single collection member row on web.
 *
 * @param props - The member recipe (with its `addedVia` provenance) and the select/remove callbacks.
 */
export const CollectionMemberRow: FC<CollectionMemberRowProps> = ({ member, onSelect, onRemove }) => {
    const { detail } = useMessages(collectionMessages);
    const cardModel = toRecipeCardModel(member);
    const sourceLabel =
        member.addedVia === RecipeCollectionAddedVia.MANUAL
            ? detail.sourceIndicatorOwned
            : detail.sourceIndicatorFromSource;
    const removeLabel = fillTemplate(detail.removeRecipe, { title: member.title });

    return (
        <RecipeCard recipe={cardModel}>
            <div className="flex flex-col gap-2 p-4">
                <div className="flex items-start justify-between gap-3">
                    <button
                        type="button"
                        aria-label={member.title}
                        onClick={() => onSelect(member.id)}
                        className="flex-1 text-left"
                    >
                        <RecipeCard.Title />
                    </button>
                    <button
                        type="button"
                        onClick={() => onRemove(member.id)}
                        // The tint is the ERROR token, not coral — see `CollectionHeader.tsx`'s Delete for the
                        // same web-only drift: `text-error-dark` (#B1442B) paired with a `bg-coral/10` (#E8917A)
                        // hover put a brand accent in the destructive register.
                        className="shrink-0 rounded-full px-3 py-1 text-body-sm font-medium text-error-dark transition hover:bg-error/10"
                    >
                        {removeLabel}
                    </button>
                </div>
                <span className="w-fit text-caption font-medium text-slate">{sourceLabel}</span>
                {member.authorHandle !== undefined && (
                    <p className="text-body-sm text-slate">
                        {fillTemplate(detail.byAuthor, { handle: member.authorHandle })}
                    </p>
                )}
                <RecipeCard.Meta />
                <RecipeCard.Badges />
            </div>
        </RecipeCard>
    );
};
