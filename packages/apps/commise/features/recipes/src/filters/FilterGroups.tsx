'use client';

/**
 * @module @commise/features-recipes/filters — the web filter groups (`docs/design/uiOverhaul/buildSpec.md` §4.4): the
 * ONE facet tree that the Discover panel and the filter sheet both draw. The container renders exactly one of them, so
 * there is one set of names for assistive technology to find.
 *
 * Each group is a named `group` (or, for a time ladder, a `radiogroup`) with its name as an overline above it. The name
 * lives once in the accessibility tree — on the row — and the visible overline is hidden from it, so a screen reader
 * does not say "Dietary, Dietary". Total time is a choice with an "Any"; prep and cook time sit behind one native
 * disclosure; a chip group shows twelve chips then "Show all ({n})", and a chosen chip is never behind it; the
 * ingredient typeahead is a search field with its results and its chosen ingredients as removable chips.
 *
 * Its state is UI state only: which groups were opened to show all, and focus intent (SC 2.4.3). The result or chip the
 * cook pressed unmounts on every ingredient add and removal, so focus moves to whatever then holds the search slot once
 * the press lands (`useIngredientPressLanding`); a filter a URL fills moves nothing.
 *
 * Presentational: it draws the facet groups from the view and reports every change.
 *
 * @pattern Visitor — an exhaustive switch over the group view's kinds
 * @pattern Adapter over the DOM focus API — `focusIfLost` and `useFocusOnSignal`, driven by presses
 */
import { useMessages } from '@commise/i18n/react';
import { Chip, ChipRow } from '@commise/ui/chip';
import { focusIfLost, useFocusOnSignal } from '@commise/ui/dialog-focus';
import { SearchField } from '@commise/ui/search-field';
import { useEffect, useId, useState, type FC, type ReactElement, type ReactNode } from 'react';

import { useIngredientPressLanding } from '../hooks/useIngredientPressLanding.js';
import { fillTemplate } from '../list/model.js';
import { recipeMessages } from '../messages.js';
import { FACET_CHIP_LIMIT, visibleChipsOf, type FacetGroupView } from './filterBarView.js';
import type { FilterGroupsProps } from './filtersModel.js';
import { filterMessages } from './messages.js';
import type { FilterAction } from './model.js';

/** A group's visible name: an overline above the row, hidden from assistive tech (the row carries the name). */
const GroupName: FC<{ readonly children: string }> = ({ children }) => (
    <span aria-hidden="true" className="text-overline uppercase text-ink-muted">
        {children}
    </span>
);

/** A group's frame: its overline, then its body. */
const GroupFrame: FC<{ readonly name: string; readonly children: ReactNode }> = ({ name, children }) => (
    <div className="flex flex-col gap-2">
        <GroupName>{name}</GroupName>
        {children}
    </div>
);

export const FilterGroups: FC<FilterGroupsProps> = ({ view, chipOverflow, ingredientSearch, onFilterAction }) => {
    const m = useMessages(filterMessages);
    // The FR-010a minimum copy is shared by all four ingredient-search surfaces — see its message doc.
    const { ingredientSearch: minimumCopy } = useMessages(recipeMessages);
    const searchId = useId();
    const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

    const ingredientGroup = view.slots.flatMap((slot) =>
        slot.kind === 'group' && slot.group?.kind === 'ingredients' ? [slot.group] : [],
    )[0];
    // One signal, two targets: only one of the note and the field is mounted, and it takes the focus once the press lands.
    const landing = useIngredientPressLanding(ingredientGroup?.selected.length ?? 0);
    const fullNoteRef = useFocusOnSignal<HTMLParagraphElement>(landing.signal);

    // `.focus()` has no declarative form. The field is the design system's `SearchField`, which takes no ref, so it is
    // found by id once the landing signal advances.
    useEffect(() => {
        if (landing.signal > 0) {
            focusIfLost(document.getElementById(searchId));
        }
    }, [landing.signal, searchId]);

    const pressIngredient = (action: FilterAction): void => {
        landing.markPressed();
        onFilterAction(action);
    };

    const toggleExpanded = (id: string): void =>
        setExpanded((current) => {
            const next = new Set(current);

            if (!next.delete(id)) {
                next.add(id);
            }

            return next;
        });

    // Each group is drawn by its kind: an exhaustive switch over the view's union.
    const drawGroup = (id: string, group: FacetGroupView): ReactElement => {
        switch (group.kind) {
            case 'chips': {
                const { shown, hiddenCount } = visibleChipsOf(group.chips, expanded.has(id));
                const canFold = expanded.has(id) && group.chips.length > FACET_CHIP_LIMIT;

                return (
                    <GroupFrame name={group.label}>
                        <ChipRow mode="filter" label={group.label} overflow={chipOverflow}>
                            {shown.map(({ chip, action }) => (
                                <Chip
                                    key={chip.value}
                                    kind="filter"
                                    label={chip.value}
                                    selected={chip.selected}
                                    {...(chip.count === undefined ? {} : { count: chip.count })}
                                    onPress={() => onFilterAction(action)}
                                />
                            ))}
                        </ChipRow>
                        {hiddenCount > 0 || canFold ? (
                            <button
                                type="button"
                                onClick={() => toggleExpanded(id)}
                                className="self-start rounded-full px-1 py-2 text-label text-action-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                            >
                                {expanded.has(id) ? m.showFewer : fillTemplate(m.showAll, { n: group.chips.length })}
                            </button>
                        ) : null}
                    </GroupFrame>
                );
            }

            case 'timeChoices':
                return (
                    <GroupFrame name={group.label}>
                        <ChipRow
                            mode="choice"
                            label={group.label}
                            overflow={chipOverflow}
                            options={group.options.map(({ value, label }) => ({ value, label }))}
                            value={group.value}
                            onChange={(next) => {
                                const picked = group.options.find((option) => option.value === next);

                                if (picked !== undefined) {
                                    onFilterAction(picked.action);
                                }
                            }}
                        />
                    </GroupFrame>
                );

            case 'ingredients':
                return (
                    <div role="group" aria-label={group.label} className="flex flex-col gap-2">
                        <GroupName>{group.label}</GroupName>
                        {/* Full: the search would fail past the server's bound (curated U9), so the note replaces it and
                            says how to free a place. The chips below stay. */}
                        {group.search.kind === 'full' ? (
                            <p
                                ref={fullNoteRef}
                                tabIndex={-1}
                                className="rounded-md text-body text-ink-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                            >
                                {fillTemplate(m.ingredientFilterFull, { max: group.search.max })}
                            </p>
                        ) : (
                            <>
                                <SearchField
                                    id={searchId}
                                    label={m.ingredientSearchLabel}
                                    labelVisibility="hidden"
                                    clearLabel={m.ingredientSearchClear}
                                    placeholder={m.ingredientSearchPlaceholder}
                                    value={ingredientSearch.query}
                                    onChangeText={ingredientSearch.onQueryChange}
                                />
                                {/* 003-FR-010a: something is typed but below the minimum. Deliberately NOT the no-matches
                                    copy — nothing was searched — and not a status, because it is guidance about the input
                                    rather than the outcome of a request. */}
                                {group.search.kind === 'tooShort' && (
                                    <p className="text-meta text-ink-muted">
                                        {fillTemplate(minimumCopy.tooShort, { minimum: group.search.minimum })}
                                    </p>
                                )}
                                {/* The label is the region's CONTENT, not only its `aria-label`: an empty status is
                                    zero-height and silent, because a live region announces content CHANGES. */}
                                {group.search.kind === 'searching' && (
                                    <p
                                        role="status"
                                        aria-label={m.ingredientSearching}
                                        className="text-meta text-ink-muted"
                                    >
                                        {m.ingredientSearching}
                                    </p>
                                )}
                                {group.search.kind === 'results' && group.search.isError && (
                                    <p role="alert" className="text-meta text-danger-text">
                                        {m.ingredientSearchError}
                                    </p>
                                )}
                                {group.search.kind === 'results' &&
                                    !group.search.isError &&
                                    group.results.length === 0 && (
                                        <p className="text-meta text-ink-muted">{m.ingredientNoMatches}</p>
                                    )}
                                {group.results.length > 0 && (
                                    <ul className="flex flex-col">
                                        {group.results.map(({ ingredient, action }) => (
                                            <li key={ingredient.foodId}>
                                                {/* Named by its ACTION ("Filter by Flour"), not the bare name: the field above
                                                    already holds that exact string, so a bare name is not uniquely addressable. */}
                                                <button
                                                    type="button"
                                                    aria-label={fillTemplate(m.addIngredientFilter, {
                                                        name: ingredient.name,
                                                    })}
                                                    onClick={() => pressIngredient(action)}
                                                    className="min-h-11 w-full rounded-md px-3 text-start text-body text-ink hover:bg-ink/6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                                                >
                                                    {ingredient.name}
                                                </button>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </>
                        )}
                        {group.selected.length > 0 && (
                            <ChipRow mode="input" label={group.label} overflow="wrap">
                                {group.selected.map(({ entry, action }) => (
                                    <Chip
                                        key={entry.foodId}
                                        kind="input"
                                        label={entry.name}
                                        removeLabel={fillTemplate(m.removeIngredientFilter, { name: entry.name })}
                                        onRemove={() => pressIngredient(action)}
                                    />
                                ))}
                            </ChipRow>
                        )}
                    </div>
                );
        }
    };

    return (
        <div className="flex flex-col gap-5">
            {view.slots.map((slot) => {
                if (slot.kind === 'disclosure') {
                    return (
                        <details key={slot.id} open={slot.open} className="group/more flex flex-col gap-3">
                            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between rounded-md text-label text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring">
                                {slot.label}
                            </summary>
                            <div className="flex flex-col gap-5 pt-1">
                                {slot.groups.map((entry) => (
                                    <div key={entry.id}>{drawGroup(entry.id, entry.group)}</div>
                                ))}
                            </div>
                        </details>
                    );
                }

                return slot.group === undefined ? null : <div key={slot.id}>{drawGroup(slot.id, slot.group)}</div>;
            })}
        </div>
    );
};
