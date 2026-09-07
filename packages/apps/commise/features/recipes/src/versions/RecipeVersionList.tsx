/**
 * @module @commise/features-recipes — web recipe version-history view (T069 building block).
 *
 * Controlled, presentational version list: renders a recipe's versions newest-first, each with its number,
 * timestamp, editor attribution (when known), and a computed "Changed: {fields}" summary versus its
 * immediately-prior version (the earliest version shows an "Initial version" label instead). The current
 * version is marked and not restorable; every other version offers Restore and (when `onPreview` is wired)
 * Preview actions, and the version being restored shows a busy status (with all restore actions disabled to
 * prevent a concurrent restore). Empty state when there is no history. A "Back to Recipe" affordance renders
 * when `onBack` is wired (V6 — the native `RecipeVersionsScreen` already composes its own back chrome, so
 * only this web leaf needs it). It fetches nothing; the composing app wires `useRecipeVersions` +
 * `useRestoreRecipeVersion` to these props.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import type { FC } from 'react';

import { recipeVersionMessages } from './messages.js';
import {
    changeSummaryForVersion,
    fillTemplate,
    formatChangedFieldNames,
    formatVersionAttribution,
    formatVersionTimestamp,
    sortVersionsDescending,
    type RecipeVersionListProps,
} from './model.js';

/**
 * The heading + optional "Back to Recipe" affordance shared by the empty and populated states.
 *
 * The heading is an `h1`: this surface's title IS the page title of `/recipes/[id]/versions`. It was an `h2`
 * only because the app shell's top bar used to render a (hard-coded "Home") `h1` above every route; now that
 * the shell's title is plain banner text, the page owns its single `h1`. Tailwind's preflight resets heading
 * font-size/weight/margin, so with the same utility classes the tag change is purely semantic — zero pixels.
 */
const VersionListHeader: FC<{
    readonly heading: string;
    readonly backLabel: string;
    readonly onBack?: () => void;
}> = ({ heading, backLabel, onBack }) => (
    <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-heading-lg font-semibold text-charcoal">{heading}</h1>
        {onBack !== undefined && (
            <button
                type="button"
                onClick={onBack}
                className="rounded-full px-4 py-1.5 text-body-sm font-medium text-ocean-dark transition hover:bg-seafoam/10"
            >
                {backLabel}
            </button>
        )}
    </div>
);

export const RecipeVersionList: FC<RecipeVersionListProps> = ({
    versions,
    currentVersion,
    restoringVersion,
    restoreError,
    onRestore,
    onPreview,
    selectedForCompare,
    onToggleCompare,
    onBack,
}) => {
    const { versionList, conflict } = useMessages(recipeVersionMessages);
    const locale = useLocale();
    const isRestoring = restoringVersion !== undefined && restoringVersion !== null;
    // B17 — a failed restore is a mandated UI state, never a silent no-op. Resolve the container's error code
    // to localized copy here so the block stays self-contained on its own copy.
    const restoreErrorMessage =
        restoreError === undefined
            ? undefined
            : restoreError === 'conflict'
              ? versionList.restoreConflictError
              : versionList.restoreGenericError;

    if (versions.length === 0) {
        return (
            <section aria-label={versionList.heading} className="mx-auto flex max-w-2xl flex-col gap-3 px-4 py-8">
                <VersionListHeader heading={versionList.heading} backLabel={versionList.backToRecipe} onBack={onBack} />
                <p className="text-body-md text-slate">{versionList.empty}</p>
            </section>
        );
    }

    return (
        <section aria-label={versionList.heading} className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-8">
            <VersionListHeader heading={versionList.heading} backLabel={versionList.backToRecipe} onBack={onBack} />
            {restoreErrorMessage !== undefined && (
                <p role="alert" className="rounded-2xl bg-error/10 px-4 py-3 text-body-sm text-error-dark">
                    {restoreErrorMessage}
                </p>
            )}
            <ul className="flex flex-col gap-3">
                {sortVersionsDescending(versions).map((version) => {
                    const isCurrent = version.versionNumber === currentVersion;
                    const isBusy = restoringVersion === version.versionNumber;
                    const attribution = formatVersionAttribution(version.editorHandle, versionList);
                    const { hasPrior, changedFields } = changeSummaryForVersion(versions, version);

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
                            {attribution !== undefined && (
                                <span className="w-full text-body-sm text-slate">{attribution}</span>
                            )}
                            {!hasPrior ? (
                                <span className="w-full text-body-sm text-slate">{versionList.initialVersion}</span>
                            ) : (
                                changedFields.length > 0 && (
                                    <span className="w-full text-body-sm text-slate">
                                        {fillTemplate(versionList.changedFields, {
                                            fields: formatChangedFieldNames(changedFields, conflict),
                                        })}
                                    </span>
                                )
                            )}
                            {version.changeSummary !== undefined && version.changeSummary.length > 0 && (
                                <span className="w-full text-body-sm text-slate">{version.changeSummary}</span>
                            )}
                            {onToggleCompare !== undefined && (
                                <label className="flex items-center gap-1.5 text-body-sm text-slate">
                                    <input
                                        type="checkbox"
                                        aria-label={fillTemplate(versionList.compareAction, {
                                            version: version.versionNumber,
                                        })}
                                        checked={selectedForCompare?.includes(version.versionNumber) ?? false}
                                        disabled={
                                            !(selectedForCompare?.includes(version.versionNumber) ?? false) &&
                                            (selectedForCompare?.length ?? 0) >= 2
                                        }
                                        onChange={() => onToggleCompare(version.versionNumber)}
                                    />
                                    {versionList.compare}
                                </label>
                            )}
                            {isCurrent ? (
                                <span className="ml-auto rounded-full bg-seafoam/10 px-3 py-1 text-caption font-medium text-ocean-dark">
                                    {versionList.currentBadge}
                                </span>
                            ) : (
                                <div className="ml-auto flex items-center gap-2">
                                    {onPreview !== undefined && (
                                        <button
                                            type="button"
                                            aria-label={fillTemplate(versionList.previewAction, {
                                                version: version.versionNumber,
                                            })}
                                            onClick={() => onPreview(version.versionNumber)}
                                            className="rounded-full px-4 py-1.5 text-body-sm font-medium text-slate transition hover:bg-slate/10"
                                        >
                                            {versionList.preview}
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        aria-label={fillTemplate(versionList.restoreAction, {
                                            version: version.versionNumber,
                                        })}
                                        disabled={isRestoring}
                                        onClick={() => onRestore(version.versionNumber)}
                                        className="rounded-full px-4 py-1.5 text-body-sm font-medium text-ocean-dark transition hover:bg-seafoam/10 disabled:opacity-60"
                                    >
                                        {versionList.restore}
                                    </button>
                                </div>
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
