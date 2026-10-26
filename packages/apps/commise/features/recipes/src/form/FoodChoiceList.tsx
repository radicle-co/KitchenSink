'use client';

/**
 * @module @commise/features-recipes/form — `FoodChoiceList` (web): the list an open pasted line shows
 * (`docs/design/uiRefreshWorkshop5/redesignCanvas/ingredientMatching.md`, owner rulings 2026-10-25). Search for a food
 * first (ruling I1), then the options in the server's order, the default with its quiet Default tag, then "Keep … as
 * written" as the last row of the same list. Offline, the words "Search needs the network" stand where search was.
 *
 * - ⛔ Each option is a BUTTON, and pressing it is the pick (staff-ux ruling 2026-10-25). A radio group would check the
 *   option the arrow keys land on, so moving through the list would pick a food and carry the cook to the next line
 *   (WCAG 3.2.2), and could pick the default, which the owner ruled is never chosen for the cook.
 * - Nothing is drawn chosen until the cook has chosen: a reopened line marks the food it holds with a check,
 *   `aria-current`, and ", chosen" in its name, so the state never rests on the glyph alone (1.4.1).
 * - Rows are 48 px at least; long names wrap and never truncate, so nothing scrolls sideways at 320 px.
 *
 * Presentational: props in, markup out; what it shows is `pasteMatchView.ts`'s. The native leaf is
 * `./FoodChoiceList.native.tsx`.
 */
import { Button } from '@commise/ui/button';
import { Icon } from '@commise/ui/icon';
import { StatusBadge } from '@commise/ui/status-badge';
import { VariantPartsLine } from '@commise/ui/variant-parts-line';
import type { FC } from 'react';

import type { FoodChoiceListProps } from './foodChoiceListProps.js';

/** The row: a 48 px button across the list, its words starting at the edge. */
const ROW_CLASS =
    'flex min-h-12 w-full items-center gap-2 rounded-xl px-3 py-2 text-start hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus-ring aria-[current=true]:bg-selected-fill';

/** An open line's list: search, the options, Keep as written. */
export const FoodChoiceList: FC<FoodChoiceListProps> = ({
    view,
    onSearch,
    onChoose,
    onKeepAsWritten,
    searchFocusRequested,
    onSearchFocusRequestHandled,
}) => (
    <div className="flex flex-col gap-2">
        {view.search.kind === 'available' ? (
            <Button
                variant="ghost"
                icon="search"
                width="fill"
                accessibilityLabel={view.search.name}
                focusRequested={searchFocusRequested}
                onFocusRequestHandled={onSearchFocusRequestHandled}
                onPress={onSearch}
            >
                {view.search.label}
            </Button>
        ) : (
            <p className="text-meta text-ink-muted">{view.search.text}</p>
        )}
        <ul aria-label={view.optionsName} className="flex flex-col">
            {view.rows.map((row) =>
                row.kind === 'food' ? (
                    <li key={row.id}>
                        <button
                            type="button"
                            aria-label={row.name}
                            aria-current={row.chosen ? 'true' : undefined}
                            className={ROW_CLASS}
                            onClick={() => onChoose(row.id)}
                        >
                            <span className="flex min-w-0 flex-1 flex-col">
                                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                    <span className="min-w-0 break-words text-body-md text-ink">{row.label}</span>
                                    {row.tag !== undefined && <StatusBadge status="note">{row.tag}</StatusBadge>}
                                </span>
                                {row.detailParts !== undefined && (
                                    <VariantPartsLine parts={row.detailParts} tone="secondary" />
                                )}
                            </span>
                            {row.chosen && (
                                <span className="text-action-text">
                                    <Icon name="check" size={20} />
                                </span>
                            )}
                        </button>
                    </li>
                ) : (
                    <li key="keepAsWritten">
                        <button type="button" aria-label={row.name} className={ROW_CLASS} onClick={onKeepAsWritten}>
                            <span className="flex min-w-0 flex-1 flex-col">
                                <span className="break-words text-body-md text-ink">{row.label}</span>
                                <span className="text-meta text-ink-muted">{row.hint}</span>
                            </span>
                        </button>
                    </li>
                ),
            )}
        </ul>
    </div>
);
