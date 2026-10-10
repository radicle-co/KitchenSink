'use client';

/**
 * @module @commise/features-recipes/collections — web collection member row (W5 Task 9, C3; slice 5 of the UI overhaul).
 *
 * One member recipe of a collection (`docs/design/uiOverhaul/buildSpec.md` §5.2): the shared {@link RecipeCard}, as a list
 * row or a grid card, with its source label — "Added by you" or "From the original collection" — on the last line, and a
 * trailing ⋯ menu named for the recipe: Open recipe, Remove from collection. The card is one link; the menu sits beside
 * it, lifted above its hit area and never inside it, so one press cannot do both.
 *
 * Removing only ASKS (`onRemove`): the screen hides the row, offers Undo, and sends the request when the snackbar commits
 * (`useMemberRemoval`). No dialog — removing does not delete the recipe (FR-012).
 *
 * @pattern Adapter over the shared `RecipeCard`, filling its note, trailing and footer slots
 */
import { useMessages } from '@commise/i18n/react';
import { ActionMenu } from '@commise/ui/action-menu';
import { RecipeCollectionAddedVia } from '@kitchensink/recipe-core';
import type { FC } from 'react';

import { RecipeCard } from '../card/RecipeCard.js';
import { toRecipeCardModel } from '../card/model.js';
import { fillTemplate } from '../format/fillTemplate.js';
import type { CollectionMemberRowProps } from './detailModel.js';
import { collectionMessages } from './messages.js';

export const CollectionMemberRow: FC<CollectionMemberRowProps> = ({
    member,
    variant,
    href,
    onSelect,
    onRemove,
    nutrition,
}) => {
    const { detail, member: copy, menu: menuCopy } = useMessages(collectionMessages);
    const recipe = toRecipeCardModel(member);
    const sourceLabel =
        member.addedVia === RecipeCollectionAddedVia.MANUAL
            ? detail.sourceIndicatorOwned
            : detail.sourceIndicatorFromSource;
    const menu = (
        <ActionMenu
            triggerLabel={fillTemplate(copy.moreActions, { title: member.title })}
            title={member.title}
            closeLabel={menuCopy.close}
            items={[
                { id: 'open', label: copy.open, onSelect: () => onSelect(member.id) },
                { id: 'remove', label: copy.remove, onSelect: () => onRemove({ id: member.id, title: member.title }) },
            ]}
        />
    );
    const link = href === undefined ? {} : { href };

    if (variant === 'row') {
        return (
            <RecipeCard
                variant="row"
                recipe={recipe}
                onSelect={onSelect}
                {...link}
                nutrition={nutrition}
                note={sourceLabel}
                trailing={menu}
            />
        );
    }

    return (
        <RecipeCard
            variant={variant}
            recipe={recipe}
            onSelect={onSelect}
            {...link}
            nutrition={nutrition}
            footer={
                <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-caption text-ink-muted">{sourceLabel}</span>
                    {menu}
                </div>
            }
        />
    );
};
