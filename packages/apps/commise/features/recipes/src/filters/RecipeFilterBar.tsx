'use client';

/**
 * @module @commise/features-recipes — web recipe filter bar (FR-006 / W4 S2).
 *
 * Controlled, presentational, facet-driven filter bar built per W9-f **P9**: the facets are DATA, read into one view by
 * `filterBarViewOf` (`./filterBarView.ts`, shared with the native leaf), and this leaf draws each facet's group by its
 * kind, so a new facet is a descriptor entry, not a new JSX branch.
 * It renders Dietary + Tags (multi-select chips), Cuisine (single-select, since the search API filters by
 * ONE cuisine), the Prep-time + Cook-time (REQ-030f) + Total-time bucket ladders, and the Ingredients
 * typeahead (FR-006 gap #3). It fetches nothing: the container owns `useIngredientFilterSearch`
 * (`hooks/useIngredientFilterSearch.ts`) and passes its live query + view state down as `ingredientSearch`, exactly
 * like `facets`/`filters` are passed down. A group with no buckets/results and no active selection is omitted (never
 * offer an empty filter) — except the ingredient search slot, which always shows the search box or, when the filter
 * is full, the note that replaces it.
 *
 * Where the facets go depends on the window (spec §S8.1a "Web below 640 px", `useFilterBarLayout`): inline in a window
 * at least 640 px wide and 480 px tall, else in the design-system `Sheet` behind a `Filters` trigger, the native
 * anatomy. While the window is unknown (server render, hydration) both render and CSS picks by the same query.
 *
 * Its state is UI state only: whether the Sheet is open, the layout it last drew, and focus intent (SC 2.4.3). The
 * option or chip the cook pressed unmounts on every ingredient add and removal, so focus moves to whatever then holds
 * the search slot once the press lands (`useIngredientPressLanding`); a filter a URL fills moves nothing. When the
 * window changes layout, the control that held focus is gone, so focus moves to the new layout's control: the
 * trigger, or the inline bar's first control. An open Sheet closes when the window leaves its layout.
 *
 * @pattern Visitor — an exhaustive switch over the facet group view's kinds
 * @pattern Adapter over the DOM focus API — `useFocusOnSignal` and `focusIfLost`, driven by presses and crossings
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { focusIfLost, useFocusOnSignal } from '@commise/ui/dialog-focus';
import { Sheet } from '@commise/ui/sheet';
import { useEffect, useRef, useState, type FC, type ReactElement } from 'react';

import { useIngredientPressLanding } from '../hooks/useIngredientPressLanding.js';
import { fillTemplate } from '../list/model.js';
import { recipeMessages } from '../messages.js';
import { filterBarViewOf, type FacetChipView, type FacetGroupView } from './filterBarView.js';
import { filterMessages } from './messages.js';
import type { FilterAction, RecipeFilterBarProps } from './model.js';
import { useFilterBarLayout } from './useFilterBarLayout.js';

/**
 * Shown only in the inline window, `FILTER_BAR_INLINE_QUERY` (`useFilterBarLayout.ts`) written as Tailwind's arbitrary
 * variant: before hydration this is all that keeps the trigger and the inline bar apart.
 */
const INLINE_ONLY = 'hidden flex-col gap-3 [@media(min-width:40rem)_and_(min-height:30rem)]:flex';
/** Hidden in the inline window, the same query. */
const SHEET_LAYOUT_ONLY = '[@media(min-width:40rem)_and_(min-height:30rem)]:hidden';
/** The native trigger's look (§S8.1a): white, the house border, a 44 px floor and a radius of half that. */
const TRIGGER =
    'inline-flex min-h-11 items-center gap-2 rounded-[calc(var(--spacing)*5.5)] border border-line-divider bg-paper px-4 ' +
    'text-body-sm font-semibold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring';
/** The count badge: a 22 px floor in rem with padding, so it grows with the text (E2 I10). */
const BADGE =
    'inline-flex min-h-5.5 min-w-5.5 items-center justify-center rounded-full bg-action px-1 py-0.5 text-overline ' +
    'font-bold text-on-action';

const CHIP_BASE =
    'inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-body-sm font-medium transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring';
const CHIP_SELECTED = 'border-selected-edge bg-action text-on-action';
/**
 * An ingredient chip removes itself, and at the cap it is the only way forward (spec §S8.1a): a trailing × the eye
 * reads (its accessible name already says "Remove {name}") and a 44 px touch height.
 */
const INGREDIENT_CHIP = 'inline-flex min-h-11 items-center gap-1.5';
const CHIP_UNSELECTED = 'border-line-divider bg-paper text-ink hover:border-seafoam-light';

export const RecipeFilterBar: FC<RecipeFilterBarProps> = ({ facets, filters, ingredientSearch, onFilterAction }) => {
    const m = useMessages(filterMessages);
    // The FR-010a minimum copy is shared by all four ingredient-search surfaces — see its message doc.
    const { ingredientSearch: minimumCopy } = useMessages(recipeMessages);
    const locale = useLocale();
    const bar = filterBarViewOf({ facets, filters, viewState: ingredientSearch.viewState }, m, locale);
    // One signal, two refs: only one of the note and the input is mounted, and it takes the focus once the press lands.
    const landing = useIngredientPressLanding(filters.ingredients?.length ?? 0);
    const fullNoteRef = useFocusOnSignal<HTMLParagraphElement>(landing.signal);
    const searchInputRef = useFocusOnSignal<HTMLInputElement>(landing.signal);

    const layout = useFilterBarLayout();
    const [open, setOpen] = useState(false);
    const [drawnLayout, setDrawnLayout] = useState(layout);
    const [crossedToInline, setCrossedToInline] = useState(0);
    const [crossedToSheet, setCrossedToSheet] = useState(0);
    const triggerRef = useFocusOnSignal<HTMLButtonElement>(crossedToSheet);
    const inlineRef = useRef<HTMLDivElement>(null);

    // The window changed layout. Learning it while hydrating is not a change: nothing was drawn by JS yet.
    if (layout !== drawnLayout) {
        setDrawnLayout(layout);

        if (drawnLayout !== undefined && layout === 'inline') {
            setOpen(false);
            setCrossedToInline(crossedToInline + 1);
        }

        if (drawnLayout !== undefined && layout === 'sheet') {
            setCrossedToSheet(crossedToSheet + 1);
        }
    }

    // `.focus()` has no declarative form. The inline bar's first control is whichever facet renders first, so it is
    // found when the crossing lands rather than held in a ref that facets arriving later would make stale.
    useEffect(() => {
        if (crossedToInline === 0) {
            return;
        }

        focusIfLost(inlineRef.current?.querySelector<HTMLElement>('button, input'));
    }, [crossedToInline]);

    const pressIngredient = (action: FilterAction): void => {
        landing.markPressed();
        onFilterAction(action);
    };

    const chipButton = ({ chip, name, action }: FacetChipView): ReactElement => (
        <button
            key={chip.value}
            type="button"
            aria-pressed={chip.selected}
            aria-label={name}
            onClick={() => onFilterAction(action)}
            className={`${CHIP_BASE} ${chip.selected ? CHIP_SELECTED : CHIP_UNSELECTED}`}
        >
            <span aria-hidden="true">{chip.value}</span>
            {chip.count !== undefined && (
                <span aria-hidden="true" className="text-caption opacity-70">
                    {chip.count}
                </span>
            )}
        </button>
    );

    const group = (label: string, children: readonly ReactElement[]): ReactElement => (
        <div role="group" aria-label={label} className="flex flex-col gap-1.5">
            <span className="text-caption font-semibold uppercase tracking-wide text-ink-muted">{label}</span>
            <div className="flex flex-wrap gap-2">{children}</div>
        </div>
    );

    // Each facet group is drawn by its kind: an exhaustive switch over the view's union.
    const drawGroup = (facet: FacetGroupView): ReactElement => {
        switch (facet.kind) {
            case 'chips':
                return group(facet.label, facet.chips.map(chipButton));
            case 'timeBuckets':
                return group(
                    facet.label,
                    facet.buckets.map((bucket) => (
                        <button
                            key={bucket.minutes}
                            type="button"
                            aria-pressed={bucket.active}
                            onClick={() => onFilterAction(bucket.action)}
                            className={`${CHIP_BASE} ${bucket.active ? CHIP_SELECTED : CHIP_UNSELECTED}`}
                        >
                            {bucket.label}
                        </button>
                    )),
                );
            case 'ingredients':
                return group(facet.label, [
                    <div key="typeahead" className="flex flex-col gap-2">
                        {/* Full: the search would fail past the server's bound (curated U9), so the note replaces it and
                        says how to free a place. The chips below stay. */}
                        {facet.search.kind === 'full' ? (
                            <p
                                ref={fullNoteRef}
                                tabIndex={-1}
                                className="rounded-md text-body-sm text-ink-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                            >
                                {fillTemplate(m.ingredientFilterFull, { max: facet.search.max })}
                            </p>
                        ) : (
                            <>
                                <input
                                    ref={searchInputRef}
                                    type="search"
                                    aria-label={m.ingredientSearchLabel}
                                    placeholder={m.ingredientSearchPlaceholder}
                                    value={ingredientSearch.query}
                                    onChange={(event) => ingredientSearch.onQueryChange(event.target.value)}
                                    // Placeholder text is TEXT: `placeholder:text-ink-muted`, never `mist` (palette JSDoc,
                                    // `@commise/ui`'s `tokens/colors.ts`). The `border-line-divider` hairline stays `mist`-derived.
                                    className="w-full rounded-lg border border-line-divider bg-paper px-3 py-2 text-body-md text-ink outline-none placeholder:text-ink-muted focus:ring-2 focus:ring-focus-ring"
                                />

                                {/* The label is the region's CONTENT, not only its `aria-label`: an empty `role="status"`
                            node is zero-height (invisible to a sighted viewer) and silent (a live region
                            announces content CHANGES, and there is none). Same doctrine as `RecipePhotoManager`
                            and the mobile `LoadingState` — the contextual label doubles as the visible caption. */}
                                {/* 003-FR-010a: something is typed but below the minimum. Deliberately NOT the
                            no-matches copy — nothing was searched — and deliberately not a `role="status"`,
                            because it is guidance about the input rather than the outcome of a request. */}
                                {facet.search.kind === 'tooShort' && (
                                    <p className="text-body-sm text-ink-muted">
                                        {fillTemplate(minimumCopy.tooShort, { minimum: facet.search.minimum })}
                                    </p>
                                )}

                                {facet.search.kind === 'searching' && (
                                    <p
                                        role="status"
                                        aria-label={m.ingredientSearching}
                                        className="text-body-sm text-ink-muted"
                                    >
                                        {m.ingredientSearching}
                                    </p>
                                )}

                                {facet.search.kind === 'results' && facet.search.isError && (
                                    <p role="alert" className="text-body-sm text-danger-text">
                                        {m.ingredientSearchError}
                                    </p>
                                )}

                                {facet.search.kind === 'results' &&
                                    !facet.search.isError &&
                                    facet.results.length === 0 && (
                                        <p className="text-body-sm text-ink-muted">{m.ingredientNoMatches}</p>
                                    )}

                                {facet.results.length > 0 && (
                                    <ul className="flex flex-col">
                                        {facet.results.map(({ ingredient, action }) => (
                                            <li key={ingredient.id}>
                                                {/* Named by its ACTION ("Filter by Flour"), not the bare ingredient name:
                                            the sibling search box already carries that exact string as its value,
                                            so a bare name is not uniquely addressable — see the
                                            `addIngredientFilter` message's doc for the failure that closes. */}
                                                <button
                                                    type="button"
                                                    aria-label={fillTemplate(m.addIngredientFilter, {
                                                        name: ingredient.name,
                                                    })}
                                                    onClick={() => pressIngredient(action)}
                                                    className="w-full rounded-lg px-3 py-2 text-left text-body-md text-ink transition hover:bg-ink/6"
                                                >
                                                    {ingredient.name}
                                                </button>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </>
                        )}

                        {facet.selected.length > 0 && (
                            <div className="flex flex-wrap gap-2">
                                {facet.selected.map(({ entry, action }) => (
                                    <button
                                        key={entry.foodId}
                                        type="button"
                                        aria-label={fillTemplate(m.removeIngredientFilter, { name: entry.name })}
                                        onClick={() => pressIngredient(action)}
                                        className={`${CHIP_BASE} ${CHIP_SELECTED} ${INGREDIENT_CHIP}`}
                                    >
                                        <span aria-hidden="true">{entry.name}</span>
                                        <span aria-hidden="true">×</span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>,
                ]);
        }
    };

    const facetBody = (
        <>
            {bar.slots.map((slot) => (
                <div key={slot.id}>{slot.group === undefined ? null : drawGroup(slot.group)}</div>
            ))}

            {bar.clearAllLabel !== undefined && (
                <div>
                    <button
                        type="button"
                        onClick={() => onFilterAction({ kind: 'clearAll' })}
                        // The LABEL is `ocean-dark` while the FOCUS RING stays seafoam — that split is the
                        // palette rule (see the palette JSDoc in `@commise/ui`'s `tokens/colors.ts`), not drift.
                        className="rounded-full px-3.5 py-1.5 text-body-sm font-semibold text-action-text underline-offset-2 transition-colors motion-reduce:transition-none hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                    >
                        {bar.clearAllLabel}
                    </button>
                </div>
            )}
        </>
    );
    // The facets render in exactly one place: with the window unknown, the inline copy steps aside while the Sheet holds
    // them, so the focus refs above always name one node.
    const showInline = layout === 'inline' || (layout === undefined && !open);

    return (
        <div>
            {layout !== 'inline' && (
                <button
                    ref={triggerRef}
                    type="button"
                    aria-label={bar.triggerLabel}
                    onClick={() => setOpen(true)}
                    className={`${TRIGGER} ${SHEET_LAYOUT_ONLY}`}
                >
                    <span>{m.filtersButton}</span>
                    {bar.activeCount > 0 && <span className={BADGE}>{bar.activeCount}</span>}
                </button>
            )}

            {showInline && (
                <div ref={inlineRef} role="group" aria-label={m.barLabel} className={INLINE_ONLY}>
                    {facetBody}
                </div>
            )}

            {/* Unmounted, not merely closed, in the inline window: a closing Sheet keeps its content for one more
                commit, and focus could not leave it for the inline bar until then. */}
            {layout !== 'inline' && (
                <Sheet
                    open={open}
                    onOpenChange={setOpen}
                    title={m.barLabel}
                    closeLabel={m.filtersClose}
                    size="content"
                    footer={
                        <Button icon="check" width="fill" onPress={() => setOpen(false)}>
                            {m.filtersDone}
                        </Button>
                    }
                >
                    <div className="flex flex-col gap-3">{facetBody}</div>
                </Sheet>
            )}
        </div>
    );
};
