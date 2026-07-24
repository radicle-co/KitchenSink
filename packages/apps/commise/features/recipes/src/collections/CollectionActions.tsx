/**
 * @module @commise/features-recipes — web collection-actions sidebar (W5 Task 7 building block).
 *
 * Presentational (pure props → JSX) render of the collection-view wireframe's right-rail "COLLECTION
 * ACTIONS" panel: Add Recipes (FR-009), Pull Updates from Source (shown only for a cloned collection,
 * FR-011), Clone Collection, and a two-stage, `canGoPrivate`-gated Public/Private visibility toggle with a
 * Save action (C1, FR-010). Composes the same controlled-radio-group + specification-result shape as the
 * sibling {@link import('../actions/RecipeVisibilityToggle.js').RecipeVisibilityToggle}: `canGoPrivate`
 * arrives as a plain boolean (the composing container's policy-fn result) and `disabledReason` as
 * already-localized copy — the gate is that one boolean prop; this component holds no eligibility logic of
 * its own. It fetches nothing and performs no mutations; every interaction is delegated upward.
 */
import { useMessages } from '@commise/i18n/react';
import { useId, type FC } from 'react';

import { RecipeVisibility } from '@kitchensink/recipe-core';

import { collectionMessages } from './messages.js';
import type { CollectionActionsProps } from './model.js';

export const CollectionActions: FC<CollectionActionsProps> = ({
    isCloned,
    visibility,
    pendingVisibility,
    canGoPrivate,
    disabledReason,
    isCloning,
    isPulling,
    onAddRecipes,
    onPullUpdates,
    onClone,
    onVisibilityChange,
    onSaveVisibility,
}) => {
    const { actions } = useMessages(collectionMessages);
    const groupName = useId();
    const reasonId = useId();
    const showReason = !canGoPrivate && disabledReason !== undefined && disabledReason.length > 0;
    const canSave = pendingVisibility !== visibility;

    // The gate is enforced in the handler too, not only via `disabled`: the component must never emit a
    // transition to `private` when `canGoPrivate` is false, however the event arrives.
    const selectPrivate = () => {
        if (canGoPrivate) {
            onVisibilityChange(RecipeVisibility.PRIVATE);
        }
    };

    const pill = (active: boolean) =>
        `relative cursor-pointer rounded-full px-4 py-1.5 text-body-sm font-medium transition ${
            active ? 'bg-card text-charcoal shadow-sm' : 'text-slate'
        }`;
    const radioOverlay = 'absolute inset-0 cursor-pointer opacity-0 disabled:cursor-not-allowed';

    return (
        <section aria-label={actions.heading} className="flex flex-col gap-4 rounded-2xl bg-card p-5 shadow-sm">
            <div className="flex flex-col gap-2">
                <button
                    type="button"
                    onClick={onAddRecipes}
                    className="rounded-full bg-seafoam px-5 py-2.5 text-body-sm font-semibold text-white shadow-sm transition hover:bg-ocean-dark"
                >
                    {actions.addRecipes}
                </button>
                {isCloned && (
                    <div className="flex flex-col gap-1">
                        <button
                            type="button"
                            onClick={onPullUpdates}
                            disabled={isPulling}
                            aria-busy={isPulling || undefined}
                            className="rounded-full px-5 py-2.5 text-body-sm font-medium text-seafoam ring-1 ring-seafoam transition hover:bg-seafoam/10 disabled:opacity-60"
                        >
                            {actions.pullUpdates}
                        </button>
                        {isPulling && (
                            <span role="status" className="text-body-sm text-slate">
                                {actions.pullingLabel}
                            </span>
                        )}
                    </div>
                )}
                <div className="flex flex-col gap-1">
                    <button
                        type="button"
                        onClick={onClone}
                        disabled={isCloning}
                        aria-busy={isCloning || undefined}
                        className="rounded-full bg-coral px-5 py-2.5 text-body-sm font-semibold text-white shadow-sm transition hover:opacity-90 disabled:opacity-60"
                    >
                        {actions.cloneCollection}
                    </button>
                    {isCloning && (
                        <span role="status" className="text-body-sm text-slate">
                            {actions.cloningLabel}
                        </span>
                    )}
                </div>
            </div>

            <fieldset aria-label={actions.visibilityGroupLabel} className="flex flex-col gap-2">
                <div className="inline-flex w-fit gap-1 rounded-full bg-pearl p-1">
                    <label className={pill(pendingVisibility === RecipeVisibility.PUBLIC)}>
                        <input
                            type="radio"
                            name={groupName}
                            className={radioOverlay}
                            checked={pendingVisibility === RecipeVisibility.PUBLIC}
                            onChange={() => onVisibilityChange(RecipeVisibility.PUBLIC)}
                        />
                        {actions.makePublic}
                    </label>
                    <label
                        className={`${pill(pendingVisibility === RecipeVisibility.PRIVATE)} ${
                            canGoPrivate ? '' : 'cursor-not-allowed opacity-50'
                        }`}
                    >
                        <input
                            type="radio"
                            name={groupName}
                            className={radioOverlay}
                            checked={pendingVisibility === RecipeVisibility.PRIVATE}
                            disabled={!canGoPrivate}
                            aria-describedby={showReason ? reasonId : undefined}
                            onChange={selectPrivate}
                        />
                        {actions.makePrivate}
                    </label>
                </div>
                {showReason && (
                    <p id={reasonId} className="text-body-sm text-warning">
                        {disabledReason}
                    </p>
                )}
                <button
                    type="button"
                    onClick={onSaveVisibility}
                    disabled={!canSave}
                    className="self-start rounded-full px-4 py-2 text-body-sm font-medium text-seafoam transition hover:bg-seafoam/10 disabled:cursor-not-allowed disabled:text-slate disabled:hover:bg-transparent"
                >
                    {actions.saveVisibility}
                </button>
            </fieldset>
        </section>
    );
};
