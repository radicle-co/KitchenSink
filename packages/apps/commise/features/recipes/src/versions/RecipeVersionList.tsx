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
            <section aria-label={versionList.heading}>
                <h2>{versionList.heading}</h2>
                <p>{versionList.empty}</p>
            </section>
        );
    }

    return (
        <section aria-label={versionList.heading}>
            <h2>{versionList.heading}</h2>
            <ul>
                {sortVersionsDescending(versions).map((version) => {
                    const isCurrent = version.versionNumber === currentVersion;
                    const isBusy = restoringVersion === version.versionNumber;

                    return (
                        <li key={version.id}>
                            <span>{fillTemplate(versionList.versionLabel, { version: version.versionNumber })}</span>
                            <span>{formatVersionTimestamp(version.createdAt, locale)}</span>
                            {version.changeSummary !== undefined && version.changeSummary.length > 0 && (
                                <span>{version.changeSummary}</span>
                            )}
                            {isCurrent ? (
                                <span>{versionList.currentBadge}</span>
                            ) : (
                                <button
                                    type="button"
                                    aria-label={fillTemplate(versionList.restoreAction, {
                                        version: version.versionNumber,
                                    })}
                                    disabled={isRestoring}
                                    onClick={() => onRestore(version.versionNumber)}
                                >
                                    {versionList.restore}
                                </button>
                            )}
                            {isBusy && (
                                <span role="status">
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
