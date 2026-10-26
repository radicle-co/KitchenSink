'use client';

/**
 * @module @commise/features-recipes/ingredientMatching — `FoodChoiceList` (web): the ONE list a line's food is chosen
 * from, in both flows (`docs/design/uiRefreshWorkshop5/redesignCanvas/ingredientMatching.md`, owner rulings
 * 2026-10-25). Search for a food first (ruling I1), then the options in the server's order, the default with its quiet
 * Default tag (`OptionLabel`), then "Keep … as written" in the `quiet` tier as the last row of the same list. Offline,
 * the words "Search needs the network" stand where search was.
 *
 * - ⛔ Each option is a BUTTON, and pressing it is the pick (staff-ux ruling 2026-10-25). A radio group would check the
 *   option the arrow keys land on, so moving through the list would pick a food and carry the cook to the next line
 *   (WCAG 3.2.2), and could pick the default, which the owner ruled is never chosen for the cook. Arrow keys do nothing.
 * - Nothing is drawn chosen until the cook has chosen: the bound food of a reopened line draws a check and its name ends
 *   ", chosen", so the state never rests on colour (1.4.1). No `aria-current` as well: it would say the state twice.
 * - While a pick is in flight its row reads busy and every row refuses a press (`aria-disabled`, so focus stays).
 * - Rows are 48 px at least, in the 13 px `list` role; long names wrap and never truncate, so nothing scrolls sideways
 *   at 320 px.
 *
 * Presentational: props in, markup out; what it shows is `matchLineView.ts`'s. The native leaf is
 * `./FoodChoiceList.native.tsx`.
 */
import { Button } from '@commise/ui/button';
import { Icon } from '@commise/ui/icon';
import { OptionLabel } from '@commise/ui/option-label';
import type { FC } from 'react';

import type { FoodChoiceListProps } from './foodChoiceListProps.js';

/** A food row: a 48 px button across the list, its words starting at the edge. */
const ROW_CLASS =
    'flex min-h-12 w-full items-center gap-2 rounded-xl px-3 py-2 text-start hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus-ring aria-disabled:cursor-default';

/** A line's food-choice list: search, the options, Keep as written. */
export const FoodChoiceList: FC<FoodChoiceListProps> = ({ view, onSearch, onPick, searchFocus }) => (
    <div className="flex flex-col gap-2">
        {view.search.kind === 'available' ? (
            <Button
                variant="ghost"
                icon="search"
                width="fill"
                accessibilityLabel={view.search.name}
                focusRequested={searchFocus.requested}
                onFocusRequestHandled={searchFocus.onHandled}
                onPress={onSearch}
            >
                {view.search.label}
            </Button>
        ) : (
            <p className="text-meta text-ink-muted">{view.search.text}</p>
        )}
        <ul aria-label={view.optionsName} className="flex flex-col">
            {view.rows.map((row) => (
                <li key={row.id}>
                    <button
                        type="button"
                        aria-label={row.name}
                        aria-disabled={view.refusing || undefined}
                        aria-busy={row.busy || undefined}
                        className={row.chosen ? `${ROW_CLASS} bg-selected-fill` : ROW_CLASS}
                        onClick={
                            view.refusing
                                ? undefined
                                : () => {
                                      onPick(row.pick);
                                  }
                        }
                    >
                        <OptionLabel
                            label={row.label}
                            textSize="list"
                            {...(row.tag === undefined ? {} : { tag: row.tag })}
                            {...(row.detailParts === undefined ? {} : { detailParts: row.detailParts })}
                        />
                        {row.chosen ? <Icon name="check" size={20} tone="actionText" /> : null}
                    </button>
                </li>
            ))}
            <li key={view.keep.id} className="flex flex-col items-start gap-1 pt-1">
                <Button
                    variant="quiet"
                    {...(view.keep.chosen ? { icon: 'check' as const } : {})}
                    accessibilityLabel={view.keep.name}
                    busy={view.keep.busy}
                    disabled={view.refusing && !view.keep.busy}
                    onPress={() => {
                        onPick(view.keep.pick);
                    }}
                >
                    {view.keep.label}
                </Button>
                <span className="px-3 text-meta text-ink-muted">{view.keep.hint}</span>
            </li>
        </ul>
    </div>
);
