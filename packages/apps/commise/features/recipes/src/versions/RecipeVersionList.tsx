/**
 * @module @commise/features-recipes — web recipe version-history view (T069 building block; build spec §6.6).
 *
 * Controlled, presentational: the `LargeTitleHeader` ("Version history", the recipe as its subtitle, Back to recipe),
 * then the versions newest first. Each row reads "Version 12 · Edited 2 days ago", what it changed against the version
 * before it ("Initial version" for the first), the editor, and a ⋯ menu: Preview · Restore this version · Compare
 * with current. The current version is marked and has no menu — there is nothing to restore or compare. While a
 * restore is in flight its row says so and every menu is unavailable. Empty: the clock glyph, "No earlier versions
 * yet", why, and Back to recipe. It fetches nothing; the composing app wires the history read and the restore.
 *
 * @pattern Humble Object — props → JSX; the row menu's entries are decided here from the wired callbacks only
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { ActionMenu, type ActionMenuItem } from '@commise/ui/action-menu';
import { Button } from '@commise/ui/button';
import { Icon } from '@commise/ui/icon';
import { LargeTitleHeader } from '@commise/ui/large-title-header';
import type { RecipeVersion } from '@kitchensink/recipe-core';
import { useId, type FC } from 'react';

import { fillTemplate } from '../format/fillTemplate.js';
import {
    type RecipeVersionListProps,
    changeSummaryForVersion,
    formatChangedFieldNames,
    formatVersionAttribution,
    restoreErrorMessage,
    sortVersionsDescending,
} from './history.js';
import { recipeVersionMessages } from './messages.js';
import { formatRelativeTimeAgo } from './timeFormat.js';

/** The web version history. */
export const RecipeVersionList: FC<RecipeVersionListProps> = ({
    versions,
    currentVersion,
    restoringVersion,
    restoreError,
    onRestore,
    onPreview,
    onCompare,
    now,
    recipeTitle,
    onBack,
    backHref,
}) => {
    const { versionList, conflict } = useMessages(recipeVersionMessages);
    const locale = useLocale();
    const headingId = useId();
    const isRestoring = restoringVersion !== undefined && restoringVersion !== null;
    // B17 — a failed restore is a mandated UI state, never a silent no-op.
    const restoreErrorText = restoreError === undefined ? undefined : restoreErrorMessage(restoreError, versionList);
    const rowMenu = (version: RecipeVersion): readonly ActionMenuItem[] => [
        ...(onPreview === undefined
            ? []
            : [
                  {
                      id: 'preview',
                      label: versionList.preview,
                      icon: 'eye' as const,
                      onSelect: () => onPreview(version.versionNumber),
                  },
              ]),
        {
            id: 'restore',
            label: versionList.restoreThis,
            icon: 'rotateCcw',
            onSelect: () => onRestore(version.versionNumber),
        },
        ...(onCompare === undefined
            ? []
            : [
                  {
                      id: 'compare',
                      label: versionList.compareWithCurrent,
                      icon: 'slidersHorizontal' as const,
                      onSelect: () => onCompare(version.versionNumber),
                  },
              ]),
    ];

    return (
        <section aria-labelledby={headingId} className="flex w-full max-w-list flex-col gap-4 pb-10">
            <LargeTitleHeader
                headingId={headingId}
                title={versionList.heading}
                {...(recipeTitle === undefined ? {} : { subtitle: recipeTitle })}
                {...(onBack === undefined
                    ? {}
                    : {
                          back: {
                              label: versionList.backToRecipe,
                              parent: recipeTitle ?? versionList.backToRecipe,
                              onPress: onBack,
                              ...(backHref === undefined ? {} : { href: backHref }),
                          },
                      })}
            />
            {restoreErrorText !== undefined && (
                <p role="alert" className="rounded-md bg-attention-tint px-4 py-3 text-meta text-ink">
                    {restoreErrorText}
                </p>
            )}
            {versions.length === 0 ? (
                <div className="flex flex-col items-center gap-3 py-10 text-center">
                    <span className="text-ink-muted">
                        <Icon name="clock" size={48} />
                    </span>
                    <h2 className="text-section-title text-ink">{versionList.empty}</h2>
                    <p className="max-w-[40ch] text-body text-ink-muted">{versionList.emptyBody}</p>
                    {onBack !== undefined && (
                        <Button variant="secondary" icon="chevronLeft" onPress={onBack}>
                            {versionList.backToRecipe}
                        </Button>
                    )}
                </div>
            ) : (
                <ul className="flex flex-col divide-y divide-line-divider">
                    {sortVersionsDescending(versions).map((version) => {
                        const isCurrent = version.versionNumber === currentVersion;
                        const attribution = formatVersionAttribution(version.editorHandle, versionList);
                        const { hasPrior, changedFields } = changeSummaryForVersion(versions, version);

                        return (
                            <li key={version.id} className="flex items-start gap-3 py-3">
                                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                                    <span data-row-title className="text-body font-semibold text-ink">
                                        {fillTemplate(versionList.rowTitle, {
                                            version: version.versionNumber,
                                            time: formatRelativeTimeAgo(version.createdAt, new Date(now), locale),
                                        })}
                                    </span>
                                    {!hasPrior ? (
                                        <span className="truncate text-meta text-ink-muted">
                                            {versionList.initialVersion}
                                        </span>
                                    ) : (
                                        changedFields.length > 0 && (
                                            <span className="truncate text-meta text-ink-muted">
                                                {fillTemplate(versionList.changedFields, {
                                                    fields: formatChangedFieldNames(changedFields, conflict),
                                                })}
                                            </span>
                                        )
                                    )}
                                    {attribution !== undefined && (
                                        <span className="text-meta text-ink-muted">{attribution}</span>
                                    )}
                                    {version.changeSummary !== undefined && version.changeSummary.length > 0 && (
                                        <span className="text-meta text-ink-muted">{version.changeSummary}</span>
                                    )}
                                    {restoringVersion === version.versionNumber && (
                                        <span role="status" className="text-meta text-ink-muted">
                                            {fillTemplate(versionList.restoringStatus, {
                                                version: version.versionNumber,
                                            })}
                                        </span>
                                    )}
                                </div>
                                {isCurrent ? (
                                    <span className="shrink-0 rounded-sm bg-selected-fill px-2 py-0.5 text-caption text-action-text">
                                        {versionList.currentBadge}
                                    </span>
                                ) : (
                                    <ActionMenu
                                        triggerLabel={fillTemplate(versionList.rowActions, {
                                            version: version.versionNumber,
                                        })}
                                        title={fillTemplate(versionList.versionLabel, {
                                            version: version.versionNumber,
                                        })}
                                        closeLabel={versionList.backToRecipe}
                                        items={rowMenu(version)}
                                        unavailable={isRestoring}
                                    />
                                )}
                            </li>
                        );
                    })}
                </ul>
            )}
        </section>
    );
};
