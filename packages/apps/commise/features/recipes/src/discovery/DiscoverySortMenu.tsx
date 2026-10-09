'use client';

/**
 * @module @commise/features-recipes/discovery — the web sort control of Discover: a ghost `sm` button "Sort: {choice}"
 * that opens a menu of four radio items with a check on the one in use (`docs/design/uiOverhaul/buildSpec.md` §4.5).
 * It is shown only while a query or filter is active, or after "See all".
 *
 * An Adapter over Radix DropdownMenu, which carries the APG Menu Button model (arrow keys, Escape, focus return) and the
 * `menuitemradio` semantics; the trigger takes the design-system button's own surface class. It is the Discover twin of
 * `LibrarySortMenu`: the same shape over a different set of options, which a third menu would be the moment to share.
 *
 * Presentational: it reports the chosen sort and holds only whether the menu is open.
 *
 * @pattern Adapter over Radix DropdownMenu's radio group
 */
import { useMessages } from '@commise/i18n/react';
import { buttonSurfaceClass } from '@commise/ui/button';
import { Icon } from '@commise/ui/icon';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import type { FC } from 'react';

import { fillTemplate } from '../list/model.js';
import { discoveryMessages } from './messages.js';
import { DISCOVERY_SORTS, discoverySortLabel, isDiscoverySort, type RecipeDiscoverySortControl } from './model.js';

const ITEM =
    'flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-3 text-body text-ink outline-none data-[highlighted]:bg-ink/6';

export const DiscoverySortMenu: FC<RecipeDiscoverySortControl> = ({ active, onChange }) => {
    const discovery = useMessages(discoveryMessages);

    return (
        <DropdownMenu.Root>
            <DropdownMenu.Trigger className={buttonSurfaceClass('ghost', 'sm')}>
                <span>{fillTemplate(discovery.sortButton, { choice: discoverySortLabel(active, discovery) })}</span>
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
                        value={active}
                        onValueChange={(next) => {
                            if (isDiscoverySort(next)) {
                                onChange(next);
                            }
                        }}
                    >
                        {DISCOVERY_SORTS.map((sort) => (
                            <DropdownMenu.RadioItem key={sort} value={sort} className={ITEM}>
                                <span className="inline-flex size-4 items-center justify-center">
                                    <DropdownMenu.ItemIndicator>
                                        <Icon name="check" size={16} />
                                    </DropdownMenu.ItemIndicator>
                                </span>
                                {discoverySortLabel(sort, discovery)}
                            </DropdownMenu.RadioItem>
                        ))}
                    </DropdownMenu.RadioGroup>
                </DropdownMenu.Content>
            </DropdownMenu.Portal>
        </DropdownMenu.Root>
    );
};
