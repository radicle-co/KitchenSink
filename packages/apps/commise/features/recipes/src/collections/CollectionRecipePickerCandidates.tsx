/**
 * @module @commise/features-recipes — the web recipe-picker's settled body: the add outcome (a polite announcement,
 * or an alert that does not hide the rows), then no recipes, no matches, or one row per candidate.
 *
 * The member and in-flight controls stay MOUNTED and focusable (`aria-disabled`, never the `disabled` attribute): a
 * `disabled` button leaves the tab order, so a keyboard user who just activated it would lose focus to `<body>`
 * mid-flow. Re-activation is suppressed in the handler, so the control cannot merely look inert.
 */
import { useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import type { FC } from 'react';

import { fillTemplate } from '../list/model.js';
import { pickerStateCard } from './collectionRecipePickerStyles.js';
import { collectionMessages } from './messages.js';
import type { CollectionRecipePickerCandidatesProps } from './model.js';

/** The presentational settled picker body: the add outcome, then no recipes, no matches, or the candidate rows. */
export const CollectionRecipePickerCandidates: FC<CollectionRecipePickerCandidatesProps> = ({
    recipes,
    memberRecipeIds,
    query,
    pendingRecipeId,
    lastAddedRecipeId,
    addFailed = false,
    onAdd,
    onCreateRecipe,
}) => {
    const { picker } = useMessages(collectionMessages);
    const addedRecipe =
        lastAddedRecipeId !== undefined ? recipes.find((recipe) => recipe.id === lastAddedRecipeId) : undefined;

    return (
        <>
            {/* The alert's fill is the ERROR token, not coral: the banner labels itself `text-danger-text`
                (#B1442B) and used to fill with `bg-coral/10` (#E8917A) — a brand accent standing in for the
                failure register, in the same element as the error-toned text. */}
            {addFailed && (
                <div role="alert" className="rounded-lg bg-danger/10 px-4 py-3 text-body-sm text-danger-text">
                    {picker.addFailed}
                </div>
            )}

            {addedRecipe !== undefined && (
                <div role="status" aria-live="polite" className="text-body-sm text-ink-muted">
                    {fillTemplate(picker.addedAnnouncement, { title: addedRecipe.title })}
                </div>
            )}

            {recipes.length === 0 ? (
                query.trim().length > 0 ? (
                    <div className={pickerStateCard}>
                        <p className="font-medium text-ink">{picker.noMatchesTitle}</p>
                    </div>
                ) : (
                    <div className={pickerStateCard}>
                        <p className="font-medium text-ink">{picker.emptyTitle}</p>
                        <p>{picker.emptyBody}</p>
                        <div className="mt-3">
                            <Button icon="plus" onPress={onCreateRecipe}>
                                {picker.createRecipe}
                            </Button>
                        </div>
                    </div>
                )
            ) : (
                <ul className="flex flex-col gap-3">
                    {recipes.map((recipe) => {
                        const isMember = memberRecipeIds.includes(recipe.id);
                        const isPending = pendingRecipeId === recipe.id;
                        const inert = isMember || isPending;
                        const controlLabel = isMember
                            ? fillTemplate(picker.memberControlLabel, { title: recipe.title })
                            : fillTemplate(picker.addRecipe, { title: recipe.title });
                        const controlText = isMember ? picker.memberBadge : isPending ? picker.adding : picker.add;

                        return (
                            <li
                                key={recipe.id}
                                className="flex items-center justify-between gap-3 rounded-2xl bg-paper p-4 shadow-sm ring-1 ring-line-divider"
                            >
                                <span className="font-display text-heading-md font-semibold text-ink">
                                    {recipe.title}
                                </span>
                                <button
                                    type="button"
                                    aria-label={controlLabel}
                                    aria-disabled={inert ? true : undefined}
                                    onClick={() => {
                                        if (!inert) {
                                            onAdd(recipe.id);
                                        }
                                    }}
                                    className={
                                        isMember
                                            ? 'rounded-full px-4 py-2 text-body-sm font-medium text-ink-muted'
                                            : isPending
                                              ? 'rounded-full px-4 py-2 text-body-sm font-medium text-ink-muted'
                                              : 'rounded-full bg-action px-4 py-2 text-body-sm font-semibold text-on-action shadow-sm transition hover:bg-ocean-dark'
                                    }
                                >
                                    {controlText}
                                </button>
                            </li>
                        );
                    })}
                </ul>
            )}
        </>
    );
};
