/**
 * @module @commise/features-recipes — web collection recipe-picker (the ADD half of T072 / FR-009).
 *
 * Controlled, presentational view that lists the caller's OWN recipes and adds them, one at a time, to a
 * single named collection. It fetches nothing: the composing app supplies the (already `query`-filtered)
 * candidate list, the current membership, the add mutation, and the per-row in-flight/success/failure
 * signals. Multi-membership (a recipe MAY belong to many collections) is expressed per row — membership is
 * scoped to THIS collection, so a row already in another collection is still addable here, and a row already
 * in THIS collection shows an inert marker rather than a re-add.
 *
 * The two bare text controls (Retry, Done) label in `ocean-dark`, not `seafoam`: seafoam as a FOREGROUND is
 * 4.02:1 on this white card and 3.57:1 under its own `hover:bg-seafoam/10` tint, both below the 4.5:1 body-text
 * floor. The tint itself stays seafoam — see the palette JSDoc in `@commise/ui` for that (single, authoritative)
 * accent-vs-text rule.
 *
 * The member and in-flight controls stay MOUNTED and focusable (`aria-disabled`, never the `disabled`
 * attribute): a `disabled` button leaves the tab order, so a keyboard user who just activated it would lose
 * focus to `<body>` mid-flow. Re-activation is suppressed in the handler, so the control cannot merely look
 * inert. A successful add is announced through a polite live region (WCAG 4.1.3); an add failure is an alert
 * that does not hide the rows, so the user can retry from the row.
 */
import { useMessages } from '@commise/i18n/react';
import type { FC, ReactElement } from 'react';

import { fillTemplate } from '../list/model.js';
import { collectionMessages } from './messages.js';
import type { CollectionRecipePickerProps } from './model.js';

export const CollectionRecipePicker: FC<CollectionRecipePickerProps> = ({
    collectionName,
    status,
    recipes,
    memberRecipeIds,
    query,
    pendingRecipeId,
    lastAddedRecipeId,
    addFailed = false,
    onQueryChange,
    onAdd,
    onRetry,
    onCreateRecipe,
    onDone,
}) => {
    const { picker } = useMessages(collectionMessages);
    const heading = fillTemplate(picker.heading, { name: collectionName });
    const addedRecipe =
        lastAddedRecipeId !== undefined ? recipes.find((recipe) => recipe.id === lastAddedRecipeId) : undefined;

    let body: ReactElement;

    if (status === 'loading') {
        // The label is the region's CONTENT, not only its `aria-label`: an empty `role="status"` node is
        // zero-height (nothing for a sighted viewer, and Playwright resolves it as `hidden`) AND silent,
        // because a live region announces its CONTENT, not its label.
        body = (
            <p role="status" aria-label={picker.loadingLabel} className="text-body-md text-slate">
                {picker.loadingLabel}
            </p>
        );
    } else if (status === 'error') {
        body = (
            <div role="alert" className="rounded-2xl bg-card p-6 text-body-md text-slate shadow-sm">
                <p className="font-medium text-charcoal">{picker.errorTitle}</p>
                <button
                    type="button"
                    onClick={onRetry}
                    className="mt-3 rounded-full px-4 py-2 text-body-sm font-medium text-ocean-dark transition hover:bg-seafoam/10"
                >
                    {picker.retry}
                </button>
            </div>
        );
    } else if (recipes.length === 0) {
        body =
            query.trim().length > 0 ? (
                <div className="rounded-2xl bg-card p-6 text-body-md text-slate shadow-sm">
                    <p className="font-medium text-charcoal">{picker.noMatchesTitle}</p>
                </div>
            ) : (
                <div className="rounded-2xl bg-card p-6 text-body-md text-slate shadow-sm">
                    <p className="font-medium text-charcoal">{picker.emptyTitle}</p>
                    <p>{picker.emptyBody}</p>
                    <button
                        type="button"
                        onClick={onCreateRecipe}
                        className="mt-3 rounded-full bg-seafoam px-5 py-2.5 text-body-sm font-semibold text-white shadow-sm transition hover:bg-ocean-dark"
                    >
                        {picker.createRecipe}
                    </button>
                </div>
            );
    } else {
        body = (
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
                            className="flex items-center justify-between gap-3 rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border"
                        >
                            <span className="font-display text-heading-md font-semibold text-charcoal">
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
                                        ? 'rounded-full px-4 py-2 text-body-sm font-medium text-slate'
                                        : isPending
                                          ? 'rounded-full px-4 py-2 text-body-sm font-medium text-slate'
                                          : 'rounded-full bg-seafoam px-4 py-2 text-body-sm font-semibold text-white shadow-sm transition hover:bg-ocean-dark'
                                }
                            >
                                {controlText}
                            </button>
                        </li>
                    );
                })}
            </ul>
        );
    }

    return (
        <section aria-label={heading} className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8">
            <header className="flex items-center justify-between gap-4">
                <h1 className="font-display text-display-md font-bold text-charcoal">{heading}</h1>
                <button
                    type="button"
                    onClick={onDone}
                    className="rounded-full px-5 py-2.5 text-body-sm font-semibold text-ocean-dark transition hover:bg-seafoam/10"
                >
                    {picker.done}
                </button>
            </header>

            <label className="flex flex-col gap-1">
                <span className="text-body-sm font-medium text-slate">{picker.searchLabel}</span>
                <input
                    type="search"
                    value={query}
                    placeholder={picker.searchPlaceholder}
                    onChange={(event) => onQueryChange(event.target.value)}
                    className="w-full rounded-lg border border-border bg-white px-3 py-2 text-body-md text-charcoal outline-none focus:ring-2 focus:ring-seafoam-light"
                />
            </label>

            {/* The alert's fill is the ERROR token, not coral: the banner labels itself `text-error`
                (#E17055) and used to fill with `bg-coral/10` (#E8917A) — a brand accent standing in for the
                failure register, in the same element as the error-toned text. */}
            {addFailed && status === 'ready' && (
                <div role="alert" className="rounded-lg bg-error/10 px-4 py-3 text-body-sm text-error">
                    {picker.addFailed}
                </div>
            )}

            {status === 'ready' && addedRecipe !== undefined && (
                <div role="status" aria-live="polite" className="text-body-sm text-slate">
                    {fillTemplate(picker.addedAnnouncement, { title: addedRecipe.title })}
                </div>
            )}

            {body}
        </section>
    );
};
