'use client';

/**
 * @module @commise/features-recipes/collections — the web member list of a collection detail
 * (`docs/design/uiOverhaul/buildSpec.md` §5.2): "6 recipes" with the list/grid switch it shares with My recipes, the
 * members as cards in the variant the host decided, "Load more ({n} more)" past the reveal window, the empty state "No
 * recipes here yet" with Add recipes, and an alert when a removal that had been committed failed. Fetch states and the
 * header belong to the composing container. It replaces `CollectionDetail`.
 *
 * Removing a row hides it (the host's `useMemberRemoval`) and offers Undo. Focus is moved BEFORE the row goes: to the next
 * row's link, else the previous row's, else the page's H1 — the pressed menu unmounts with its row, and focus would
 * otherwise drop to the page (SC 2.4.3). The reveal count is local view state; if a caller reuses this component across
 * collections without remounting it, key it by the collection id.
 *
 * Presentational: it fetches nothing and sends nothing; the host decides the view and runs the removals.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { SegmentedControl } from '@commise/ui/segmented-control';
import { useState, type FC } from 'react';

import { COMPACT_GRID_CLASS, GRID_CELL_CLASS, LIBRARY_GRID_CLASS, LIBRARY_LIST_CLASS } from '../card/cardGridClass.js';
import { LIST_VIEW_MODES, isListViewMode } from '../card/cardVariant.js';
import type { RemovableMember } from '../hooks/useMemberRemoval.js';
import { formatRecipeCount } from '../list/model.js';
import { fillTemplate } from '../format/fillTemplate.js';
import { CollectionMemberRow } from './CollectionMemberRow.js';
import { MEMBER_WINDOW_SIZE, type CollectionMembersProps } from './detailModel.js';
import { collectionMessages } from './messages.js';

/** The list's class for a variant: a column of rows, a grid of full cards, or two-up compact cards. */
const LIST_CLASS = { row: LIBRARY_LIST_CLASS, grid: LIBRARY_GRID_CLASS, compact: COMPACT_GRID_CLASS } as const;

export const CollectionMembers: FC<CollectionMembersProps> = ({
    members,
    viewMode,
    onViewModeChange,
    variant,
    hrefOf,
    onSelectRecipe,
    onRemoveRecipe,
    onAddRecipes,
    removeFailedTitle,
    renderNutrition,
    headingId,
}) => {
    const { detail, member: copy } = useMessages(collectionMessages);
    const locale = useLocale();
    const [revealCount, setRevealCount] = useState(MEMBER_WINDOW_SIZE);
    const visible = members.slice(0, revealCount);
    const remaining = members.length - visible.length;

    const remove = (member: RemovableMember): void => {
        const index = visible.findIndex((entry) => entry.id === member.id);
        const next = visible[index + 1] ?? visible[index - 1];
        const target =
            next === undefined
                ? headingId === undefined
                    ? null
                    : document.getElementById(headingId)
                : document.querySelector<HTMLElement>(`li[data-member-id="${CSS.escape(next.id)}"] :is(a, button)`);

        target?.focus();
        onRemoveRecipe(member);
    };

    return (
        <section aria-label={detail.membersHeading} className="flex flex-col gap-3">
            {removeFailedTitle === undefined ? null : (
                <p role="alert" className="text-body text-danger-text">
                    {fillTemplate(copy.removeFailed, { title: removeFailedTitle })}
                </p>
            )}
            {members.length === 0 ? (
                <div className="flex flex-col items-start gap-3 py-6">
                    <h2 className="text-section-title text-ink">{detail.emptyTitle}</h2>
                    <p className="text-body text-ink-muted">{detail.emptyBody}</p>
                    <Button icon="plus" onPress={onAddRecipes}>
                        {detail.addRecipeCta}
                    </Button>
                </div>
            ) : (
                <>
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                        <p className="text-meta font-semibold text-ink tabular-nums lining-nums">
                            {formatRecipeCount(
                                members.length,
                                { one: detail.recipeCountOne, other: detail.recipeCountOther },
                                locale,
                            )}
                        </p>
                        <SegmentedControl
                            form="view"
                            label={detail.viewLabel}
                            labelVisibility="hidden"
                            value={viewMode}
                            onChange={(mode) => {
                                if (isListViewMode(mode)) {
                                    onViewModeChange(mode);
                                }
                            }}
                            segments={LIST_VIEW_MODES.map((mode) => ({
                                id: mode,
                                label: mode === 'list' ? detail.viewList : detail.viewGrid,
                                icon: mode === 'list' ? 'list' : 'layoutGrid',
                            }))}
                        />
                    </div>
                    <ul className={LIST_CLASS[variant]}>
                        {visible.map((member) => (
                            <li
                                key={member.id}
                                data-member-id={member.id}
                                className={variant === 'grid' ? GRID_CELL_CLASS : undefined}
                            >
                                <CollectionMemberRow
                                    member={member}
                                    variant={variant}
                                    {...(hrefOf === undefined ? {} : { href: hrefOf(member.id) })}
                                    onSelect={onSelectRecipe}
                                    onRemove={remove}
                                    nutrition={renderNutrition?.(member.id)}
                                />
                            </li>
                        ))}
                    </ul>
                    {remaining > 0 && (
                        // W5/C7 — client-side member-list windowing (no member-pagination endpoint).
                        <div className="self-center">
                            <Button
                                variant="secondary"
                                icon="chevronDown"
                                onPress={() =>
                                    setRevealCount((count) => Math.min(members.length, count + MEMBER_WINDOW_SIZE))
                                }
                            >
                                {fillTemplate(detail.loadMore, { count: remaining })}
                            </Button>
                        </div>
                    )}
                </>
            )}
        </section>
    );
};
