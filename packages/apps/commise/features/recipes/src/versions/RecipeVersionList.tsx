/**
 * @module @commise/features-recipes — web recipe version-history view (T069 building block).
 *
 * Controlled, presentational version list: renders a recipe's versions newest-first, each with its number
 * and timestamp; the current version is marked and not restorable, every other version offers a Restore
 * action, and the version being restored shows a busy status (with all restore actions disabled to prevent
 * a concurrent restore). Empty state when there is no history. It fetches nothing; the composing app wires
 * `useRecipeVersions` + `useRestoreRecipeVersion` to these props.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import type { FC } from 'react';

import { recipeVersionMessages } from './messages.js';
import { fillTemplate, formatVersionTimestamp, sortVersionsDescending, type RecipeVersionListProps } from './model.js';

export const RecipeVersionList: FC<RecipeVersionListProps> = ({
    versions,
    currentVersion,
    restoringVersion,
    onRestore,
}) => {
    const { versionList } = useMessages(recipeVersionMessages);
    const locale = useLocale();
    const isRestoring = restoringVersion !== undefined && restoringVersion !== null;

    if (versions.length === 0) {
        return (
            <section aria-label={versionList.heading} className="mx-auto flex max-w-2xl flex-col gap-3 px-4 py-8">
                <h2 className="font-display text-heading-lg font-semibold text-charcoal">{versionList.heading}</h2>
                <p className="text-body-md text-slate">{versionList.empty}</p>
            </section>
        );
    }

    return (
        <section aria-label={versionList.heading} className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-8">
            <h2 className="font-display text-heading-lg font-semibold text-charcoal">{versionList.heading}</h2>
            <ul className="flex flex-col gap-3">
                {sortVersionsDescending(versions).map((version) => {
                    const isCurrent = version.versionNumber === currentVersion;
                    const isBusy = restoringVersion === version.versionNumber;

                    return (
                        <li
                            key={version.id}
                            className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border"
                        >
                            <span className="font-display font-semibold text-charcoal">
                                {fillTemplate(versionList.versionLabel, { version: version.versionNumber })}
                            </span>
                            <span className="text-body-sm text-slate">
                                {formatVersionTimestamp(version.createdAt, locale)}
                            </span>
                            {version.changeSummary !== undefined && version.changeSummary.length > 0 && (
                                <span className="w-full text-body-sm text-slate">{version.changeSummary}</span>
                            )}
                            {isCurrent ? (
                                <span className="ml-auto rounded-full bg-seafoam/10 px-3 py-1 text-caption font-medium text-seafoam">
                                    {versionList.currentBadge}
                                </span>
                            ) : (
                                <button
                                    type="button"
                                    aria-label={fillTemplate(versionList.restoreAction, {
                                        version: version.versionNumber,
                                    })}
                                    disabled={isRestoring}
                                    onClick={() => onRestore(version.versionNumber)}
                                    className="ml-auto rounded-full px-4 py-1.5 text-body-sm font-medium text-seafoam transition hover:bg-seafoam/10 disabled:opacity-60"
                                >
                                    {versionList.restore}
                                </button>
                            )}
                            {isBusy && (
                                <span role="status" className="w-full text-body-sm text-slate">
                                    {fillTemplate(versionList.restoringStatus, { version: version.versionNumber })}
                                </span>
                            )}
                        </li>
                    );
                })}
            </ul>
        </section>
    );
};
