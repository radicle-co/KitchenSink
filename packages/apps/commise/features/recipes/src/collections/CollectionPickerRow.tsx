'use client';

/**
 * @module @commise/features-recipes/collections — one row of the add-recipes picker (`docs/design/uiOverhaul/buildSpec.md`
 * §5.3): 64 px tall, a 48 px thumbnail, the title (two lines), one meta line (cuisine · time), and a trailing 28 px circle
 * — off: a `lineControl` outline; on: `action` filled with a check. The whole row is ONE control, `role="checkbox"` with
 * `aria-checked`, named by the recipe, so a screen reader hears "Pasta, checkbox, checked" and Space toggles it.
 *
 * Each press asks for the OPPOSITE of what the row shows and the host saves it at once; a refused toggle flips the row back
 * and an inline alert names the recipe ("Couldn't add Pasta. Try again."). The state glyph is a check, so checked never
 * rests on colour alone.
 *
 * Presentational: it sends nothing; the host runs the toggle.
 */
import { useMessages } from '@commise/i18n/react';
import { Icon } from '@commise/ui/icon';
import { RecipeCover } from '@commise/ui/recipe-cover';
import type { FC } from 'react';

import { toRecipeCardModel } from '../card/model.js';
import { useRecipeCardView } from '../card/useRecipeCardView.js';
import { fillTemplate } from '../list/model.js';
import type { CollectionPickerRowProps } from './detailModel.js';
import { collectionMessages } from './messages.js';

export const CollectionPickerRow: FC<CollectionPickerRowProps> = ({ recipe, checked, failed, onToggle }) => {
    const { picker } = useMessages(collectionMessages);
    const model = toRecipeCardModel(recipe);
    const view = useRecipeCardView(model);
    const meta = [recipe.cuisine, view.meta.duration].filter(
        (part): part is string => part !== undefined && part !== '',
    );

    return (
        <div className="flex flex-col gap-1">
            <div
                role="checkbox"
                aria-checked={checked}
                aria-label={recipe.title}
                tabIndex={0}
                onClick={() => onToggle(!checked)}
                onKeyDown={(event) => {
                    if (event.key === ' ' || event.key === 'Enter') {
                        event.preventDefault();
                        onToggle(!checked);
                    }
                }}
                className="flex min-h-16 cursor-pointer items-center gap-3 rounded-md px-2 py-2 hover:bg-ink/6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            >
                <span aria-hidden="true" className="relative size-12 shrink-0 overflow-hidden rounded-md">
                    <RecipeCover
                        recipeId={recipe.id}
                        title={recipe.title}
                        aspect="1:1"
                        {...(recipe.cuisine === undefined ? {} : { cuisine: recipe.cuisine })}
                        {...(recipe.coverPhotoUrl === undefined ? {} : { photoUrl: recipe.coverPhotoUrl })}
                    />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                    <span className="line-clamp-2 text-card-title text-ink">{recipe.title}</span>
                    <span className="truncate text-meta text-ink-muted">{meta.join(' · ')}</span>
                </span>
                <span
                    aria-hidden="true"
                    className={`inline-flex size-7 shrink-0 items-center justify-center rounded-full ${
                        checked ? 'bg-action text-on-action' : 'border-2 border-line-control'
                    }`}
                >
                    {checked ? <Icon name="check" size={16} /> : null}
                </span>
            </div>
            {failed === undefined ? null : (
                <p role="alert" className="px-2 text-meta text-danger-text">
                    {fillTemplate(failed === 'add' ? picker.toggleAddFailed : picker.toggleRemoveFailed, {
                        title: recipe.title,
                    })}
                </p>
            )}
        </div>
    );
};
