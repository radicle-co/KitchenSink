'use client';

/**
 * @module @commise/features-recipes/collections — the web collection header (W5 Task 6; slice 5 of the UI overhaul).
 *
 * `docs/design/uiOverhaul/buildSpec.md` §5.2: "‹ Collections" back, the name as the page's one H1 (`LargeTitleHeader`), the
 * meta line — visibility as an icon and a word, "6 recipes" and, for a copy, "Copied from @clara" — the description, and
 * ONE primary (Add recipes) with ONE ⋯ menu named for the collection: Rename · Make private / Make public · Save a copy ·
 * Pull updates (copies only) · divider · Delete collection. Each meta item is a group that never breaks inside; the row
 * wraps between groups.
 *
 * The pair sits at the end of the title row from a 600 container and under the description below it
 * (`actionsPlacement`, decided by the host), and is drawn once either way — the title row's `action` slot takes one button
 * plus one ⋯ menu (Settled here 28). Presentational: it sends nothing; the host's hooks run every request.
 *
 * @pattern Composite — the title, meta, description and actions of one collection
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { ActionMenu } from '@commise/ui/action-menu';
import { Button } from '@commise/ui/button';
import { Icon } from '@commise/ui/icon';
import { LargeTitleHeader } from '@commise/ui/large-title-header';
import { RefreshNotice } from '@commise/ui/refresh-notice';
import { RecipeVisibility } from '@kitchensink/recipe-core';
import type { FC, ReactNode } from 'react';

import { formatRecipeCount } from '../list/model.js';
import { fillTemplate } from '../format/fillTemplate.js';
import type { CollectionHeaderProps } from './detailModel.js';
import { collectionMessages } from './messages.js';
import { formatCollectionDate } from './model.js';

/** One meta item: an unbreakable group, with the locale's separator drawn before every item after the first. */
const META_ITEM =
    'inline-flex items-center gap-1 whitespace-nowrap not-first:before:me-2 not-first:before:text-ink-muted not-first:before:content-["·"]';

export const CollectionHeader: FC<CollectionHeaderProps> = ({
    name,
    description,
    visibility,
    recipeCount,
    sourceCollectionName,
    sourceOwnerHandle,
    sourceCollectionId,
    lastPulledAt,
    actionsPlacement,
    headingId,
    headingFocusSignal,
    onBack,
    backHref,
    onAddRecipes,
    onViewSource,
    refreshNotice,
    onRename,
    onToggleVisibility,
    onSaveCopy,
    onPullUpdates,
    onDelete,
}) => {
    const { detail, list, menu: copy, header } = useMessages(collectionMessages);
    const locale = useLocale();
    const isPublic = visibility === RecipeVisibility.PUBLIC;
    const isCopy = sourceCollectionName !== undefined || sourceCollectionId !== undefined;
    // A retry from the refresh notice that succeeds removes the button the viewer pressed, so focus goes to the name.
    const focusSignal = headingFocusSignal + (refreshNotice?.recoveries ?? 0);

    const copiedFrom =
        sourceOwnerHandle !== undefined
            ? fillTemplate(detail.copiedFrom, { handle: sourceOwnerHandle })
            : sourceCollectionName !== undefined
              ? fillTemplate(detail.copiedFromNamed, { name: sourceCollectionName })
              : detail.copiedFromUnknown;

    const add = (
        <Button icon="plus" width={actionsPlacement === 'below' ? 'fill' : 'auto'} onPress={onAddRecipes}>
            {detail.addRecipeCta}
        </Button>
    );
    const menu = (
        <ActionMenu
            triggerLabel={fillTemplate(copy.moreActions, { name })}
            title={name}
            closeLabel={copy.close}
            items={[
                { id: 'rename', label: copy.rename, onSelect: onRename },
                {
                    id: 'visibility',
                    label: isPublic ? copy.makePrivate : copy.makePublic,
                    onSelect: onToggleVisibility,
                },
                { id: 'saveCopy', label: copy.saveCopy, onSelect: onSaveCopy },
                ...(isCopy ? [{ id: 'pull', label: copy.pullUpdates, onSelect: onPullUpdates }] : []),
            ]}
            destructiveItem={{ id: 'delete', label: copy.delete, onSelect: onDelete }}
        />
    );

    const metaItem = (key: string, children: ReactNode): ReactNode => (
        <span key={key} className={META_ITEM}>
            {children}
        </span>
    );

    return (
        <div className="flex flex-col gap-3">
            <LargeTitleHeader
                headingId={headingId}
                title={name}
                focusSignal={focusSignal}
                back={{
                    label: fillTemplate(detail.backTo, { parent: list.heading }),
                    parent: list.heading,
                    onPress: onBack,
                    ...(backHref === undefined ? {} : { href: backHref }),
                }}
                {...(actionsPlacement === 'title' ? { action: { kind: 'controls', button: add, menu } } : {})}
            />
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-meta text-ink-muted">
                {metaItem(
                    'visibility',
                    <>
                        <Icon name={isPublic ? 'globe' : 'lock'} size={16} />
                        {isPublic ? detail.visibilityPublic : detail.visibilityPrivate}
                    </>,
                )}
                {metaItem(
                    'count',
                    formatRecipeCount(
                        recipeCount,
                        { one: detail.recipeCountOne, other: detail.recipeCountOther },
                        locale,
                    ),
                )}
                {isCopy
                    ? metaItem(
                          'source',
                          onViewSource !== undefined && sourceCollectionId !== undefined ? (
                              <button
                                  type="button"
                                  onClick={() => onViewSource(sourceCollectionId)}
                                  className="rounded-sm text-action-text underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                              >
                                  {copiedFrom}
                              </button>
                          ) : (
                              copiedFrom
                          ),
                      )
                    : null}
            </p>
            {lastPulledAt === undefined ? null : (
                <p className="text-caption text-ink-muted">
                    {fillTemplate(header.lastPulled, { date: formatCollectionDate(lastPulledAt, locale) })}
                </p>
            )}
            {description === undefined || description === '' ? null : (
                <p className="text-body text-ink">{description}</p>
            )}
            {actionsPlacement === 'below' ? (
                <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">{add}</div>
                    {menu}
                </div>
            ) : null}
            {refreshNotice === undefined ? null : (
                <RefreshNotice
                    failed={refreshNotice.failed}
                    refreshing={refreshNotice.refreshing}
                    onRetry={refreshNotice.onRetry}
                    labels={{ failed: detail.refreshError, retry: detail.refreshRetry }}
                />
            )}
        </div>
    );
};
