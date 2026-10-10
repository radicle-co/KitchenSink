'use client';

/**
 * @module @commise/features-recipes/form — `MoveToGroupSheet` (web): a row's `⋯` Move to group… (build spec §7.5.5): a
 * sheet listing the groups and "No group", the line's current one marked with a check and `aria-current`. A choice moves
 * the line and closes the sheet.
 *
 * Presentational: `props → JSX` over the field group's Move to group view.
 *
 * @pattern Decorator — the sheet frame around a list of choices
 */
import { Icon } from '@commise/ui/icon';
import { Sheet } from '@commise/ui/sheet';
import type { FC } from 'react';

import type { MoveToGroupView } from './useIngredientGroups.js';

/** The Move to group sheet. */
export const MoveToGroupSheet: FC<{ readonly view: MoveToGroupView }> = ({ view }) => (
    <Sheet
        open={view.open}
        onOpenChange={(next) => {
            if (!next) {
                view.onClose();
            }
        }}
        title={view.title}
        closeLabel={view.closeLabel}
        size="content"
    >
        <ul className="flex flex-col">
            {view.choices.map((choice) => (
                <li key={choice.key}>
                    <button
                        type="button"
                        aria-current={choice.current || undefined}
                        onClick={choice.onSelect}
                        className="flex min-h-14 w-full items-center justify-between gap-3 rounded-md px-2 text-left text-body-md text-ink transition hover:bg-ink/6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                    >
                        <span className="min-w-0 break-words">{choice.label}</span>
                        {choice.current && (
                            <span aria-hidden="true" className="inline-flex shrink-0">
                                <Icon name="check" size={20} />
                            </span>
                        )}
                    </button>
                </li>
            ))}
        </ul>
    </Sheet>
);
