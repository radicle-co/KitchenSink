'use client';

/**
 * @module @commise/features-recipes/ingredientMatching — `FoodChoiceList` (web): the ONE list a line's food is chosen
 * from, in both flows (`docs/design/uiRefreshWorkshop5/redesignCanvas/ingredientMatching.md`, owner rulings
 * 2026-10-25). Search for a food first (ruling I1), at its own width so its words start at the rows' edge (U5); then ONE
 * bordered box on the raised paper (U2) holding the options in the server's order, the default with its quiet Default
 * tag (`OptionLabel`), and "Keep “line” as written · no nutrition" as its last row in the quiet ink (U6), rules between
 * the rows. Offline, the words "Search needs the network" stand where search was.
 *
 * - ⛔ Each option is a BUTTON (`ChoiceRow`), and pressing it is the pick (staff-ux ruling 2026-10-25). A radio group
 *   would check the option the arrow keys land on, so moving through the list would pick a food and carry the cook to
 *   the next line (WCAG 3.2.2), and could pick the default, which the owner ruled is never chosen for the cook.
 * - Nothing is drawn chosen until the cook has chosen: the bound food of a reopened line draws a check and its name ends
 *   ", chosen", so the state never rests on colour (1.4.1). No `aria-current` as well: it would say the state twice.
 * - While a send is in flight the control that started it spins and reads busy — the row, or Search for a food found
 *   through it — and every other control is refused: focusable, the press cancelled, dimmed (2.4.3). None is ever
 *   natively disabled, because any of them may hold focus when the send starts.
 * - A focus request lands on the view's `focusTarget`: Search, else the first option, else Keep, so it is always taken.
 * - When Try again unmounts because a retry started, focus lands on the view's `landing`: the control that send made busy
 *   (still drawn, refused, never natively disabled), so focus is never dropped to the page (2.4.3).
 * - Rows are 48 px at least, in the 14 px `list` role; long names wrap and never truncate, so nothing scrolls sideways
 *   at 320 px.
 *
 * Presentational: props in, markup out; what it shows is `matchLineView.ts`'s. The native leaf is
 * `./FoodChoiceList.native.tsx`.
 */
import { Button } from '@commise/ui/button';
import { ChoiceRow } from '@commise/ui/choice-row';
import { OptionLabel } from '@commise/ui/option-label';
import type { FC } from 'react';

import type { FoodChoiceListProps } from './foodChoiceListProps.js';
import { listControlFocusOf } from './listControlFocus.js';
import type { ListFocusTarget } from './matchLineView.js';

/** A line's food-choice list: search, then the options and Keep as written in one box. */
export const FoodChoiceList: FC<FoodChoiceListProps> = ({ view, onSearch, onPick, focus, landing }) => {
    const { search, keep } = view;
    const focusOf = (control: ListFocusTarget) => listControlFocusOf(view, control, { focus, landing });

    return (
        <div className="flex flex-col gap-2">
            {search.kind === 'available' ? (
                <div className="flex">
                    <Button
                        variant="ghost"
                        icon="search"
                        accessibilityLabel={search.name}
                        busy={search.busy}
                        refused={view.refusing && !search.busy}
                        {...focusOf({ kind: 'search' })}
                        onPress={onSearch}
                    >
                        {search.label}
                    </Button>
                </div>
            ) : (
                <p className="break-words text-list text-ink-muted">{search.text}</p>
            )}
            <ul
                aria-label={view.optionsName}
                className="flex flex-col divide-y divide-line-divider overflow-hidden rounded-xl border border-line-divider bg-paper-raised"
            >
                {view.rows.map((row) => (
                    <li key={row.id}>
                        <ChoiceRow
                            accessibilityLabel={row.name}
                            chosen={row.chosen}
                            busy={row.busy}
                            refused={view.refusing && !row.busy}
                            {...focusOf({ kind: 'row', id: row.id })}
                            onPress={() => {
                                onPick(row.pick);
                            }}
                        >
                            <OptionLabel
                                label={row.label}
                                textSize="list"
                                {...(row.tag === undefined ? {} : { tag: row.tag })}
                                {...(row.detailParts === undefined ? {} : { detailParts: row.detailParts })}
                            />
                        </ChoiceRow>
                    </li>
                ))}
                <li key={keep.id}>
                    <ChoiceRow
                        accessibilityLabel={keep.name}
                        chosen={keep.chosen}
                        busy={keep.busy}
                        refused={view.refusing && !keep.busy}
                        {...focusOf({ kind: 'keep' })}
                        onPress={() => {
                            onPick(keep.pick);
                        }}
                    >
                        <span className="min-w-0 flex-1 break-words text-list text-ink-muted">{keep.label}</span>
                    </ChoiceRow>
                </li>
            </ul>
        </div>
    );
};
