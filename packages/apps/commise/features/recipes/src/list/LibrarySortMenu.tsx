'use client';

/**
 * @module @commise/features-recipes/list — the web sort control of My recipes: a ghost `sm` button "Sort: {choice}"
 * that opens a menu of radio items with a check on the chosen one — the shape `docs/design/uiOverhaul/buildSpec.md`
 * §4.5 gives Discover's sort, used here for the library's three server sorts
 * (`docs/architecture/uiOverhaulBlueprint.md` A11).
 *
 * An Adapter over Radix DropdownMenu, which carries the APG Menu Button model (arrow keys, Escape, focus return) and
 * the `menuitemradio` semantics; the trigger takes the design-system button's own surface class.
 *
 * @pattern Adapter over Radix DropdownMenu's radio group
 */
import { useMessages } from '@commise/i18n/react';
import { buttonSurfaceClass } from '@commise/ui/button';
import { Icon } from '@commise/ui/icon';
import type { RecipeListSortBy } from '@kitchensink/recipe-service-client';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import type { FC } from 'react';

import { recipeMessages } from '../messages.js';
import { LIBRARY_SORTS, sortLabelOf } from './library.js';
import { type RecipeListSortControl } from './model.js';
import { fillTemplate } from '../format/fillTemplate.js';

const ITEM =
    'flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-3 text-body text-ink outline-none data-[highlighted]:bg-ink/6';

/**
 * Whether a menu value is one of the sorts. Radix reports a string; only a known key is passed on.
 *
 * @param value - The chosen value.
 * @returns `true` for a sort key.
 */
function isLibrarySort(value: string): value is RecipeListSortBy {
    return (LIBRARY_SORTS as readonly string[]).includes(value);
}

/**
 * The sort control.
 *
 * @param props - The sort in use and how to change it.
 * @returns The trigger and its menu.
 */
export const LibrarySortMenu: FC<RecipeListSortControl> = ({ value, onChange }) => {
    const { list } = useMessages(recipeMessages);
    const choice = sortLabelOf(value, list);

    // The visible label is the choice alone, so the result bar's controls fit a 320 px phone (F5); the name keeps
    // "Sort: …" and contains the visible text (SC 2.5.3).
    return (
        <DropdownMenu.Root>
            <DropdownMenu.Trigger
                aria-label={fillTemplate(list.sortButton, { choice })}
                className={buttonSurfaceClass('ghost', 'sm')}
            >
                <span>{choice}</span>
                <Icon name="chevronDown" size={16} />
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
                <DropdownMenu.Content
                    align="end"
                    sideOffset={4}
                    collisionPadding={8}
                    className="z-50 min-w-[12rem] rounded-lg bg-paper-overlay p-1 shadow-lg"
                >
                    <DropdownMenu.RadioGroup
                        value={value}
                        onValueChange={(next) => {
                            if (isLibrarySort(next)) {
                                onChange(next);
                            }
                        }}
                    >
                        {LIBRARY_SORTS.map((sort) => (
                            <DropdownMenu.RadioItem key={sort} value={sort} className={ITEM}>
                                <span className="inline-flex size-4 items-center justify-center">
                                    <DropdownMenu.ItemIndicator>
                                        <Icon name="check" size={16} />
                                    </DropdownMenu.ItemIndicator>
                                </span>
                                {sortLabelOf(sort, list)}
                            </DropdownMenu.RadioItem>
                        ))}
                    </DropdownMenu.RadioGroup>
                </DropdownMenu.Content>
            </DropdownMenu.Portal>
        </DropdownMenu.Root>
    );
};
