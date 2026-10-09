/**
 * @module @commise/features-recipes — native recipe version-history view (T069 building block; build spec §6.6): the
 * mirror of `RecipeVersionList.tsx`. The `LargeTitleHeader` ("Version history", the recipe as its subtitle — the
 * screen composes its own back chrome), then the versions newest first with the relative edit time, what each changed,
 * the editor and a ⋯ menu (a bottom sheet): Preview · Restore this version · Compare with current. The current version
 * is marked and has no menu. Colours come from the theme at render.
 *
 * @pattern Humble Object — props → JSX; the row menu's entries are decided here from the wired callbacks only
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { ActionMenu, type ActionMenuItem } from '@commise/ui/action-menu';
import { Icon } from '@commise/ui/icon';
import { LargeTitleHeader } from '@commise/ui/large-title-header';
import { nativeTokens } from '@commise/ui/native';
import { useTheme } from '@commise/ui/theme';
import type { RecipeVersion } from '@kitchensink/recipe-core';
import { useId, type FC } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { fillTemplate } from '../list/model.js';
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

/** The native version history. */
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
}) => {
    const { versionList, conflict } = useMessages(recipeVersionMessages);
    const locale = useLocale();
    const { colors } = useTheme();
    const headingId = useId();
    const isRestoring = restoringVersion !== undefined && restoringVersion !== null;
    const restoreErrorText = restoreError === undefined ? undefined : restoreErrorMessage(restoreError, versionList);
    const muted = { color: colors.inkMuted };
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
        <View style={styles.container}>
            <LargeTitleHeader
                headingId={headingId}
                title={versionList.heading}
                {...(recipeTitle === undefined ? {} : { subtitle: recipeTitle })}
            />
            {restoreErrorText !== undefined && (
                <View
                    collapsable={false}
                    accessibilityRole="alert"
                    style={[styles.alert, { backgroundColor: colors.attentionTint }]}
                >
                    <Text style={[styles.meta, { color: colors.ink }]}>{restoreErrorText}</Text>
                </View>
            )}
            {versions.length === 0 ? (
                <View style={styles.empty}>
                    <Icon name="clock" size={48} tone="inkMuted" />
                    <Text style={[styles.emptyTitle, { color: colors.ink }]}>{versionList.empty}</Text>
                    <Text style={[styles.body, muted]}>{versionList.emptyBody}</Text>
                </View>
            ) : (
                <View>
                    {sortVersionsDescending(versions).map((version) => {
                        const isCurrent = version.versionNumber === currentVersion;
                        const attribution = formatVersionAttribution(version.editorHandle, versionList);
                        const { hasPrior, changedFields } = changeSummaryForVersion(versions, version);

                        return (
                            <View key={version.id} style={[styles.row, { borderBottomColor: colors.lineDivider }]}>
                                <View style={styles.rowText}>
                                    <Text style={[styles.rowTitle, { color: colors.ink }]}>
                                        {fillTemplate(versionList.rowTitle, {
                                            version: version.versionNumber,
                                            time: formatRelativeTimeAgo(version.createdAt, new Date(now), locale),
                                        })}
                                    </Text>
                                    {!hasPrior ? (
                                        <Text numberOfLines={1} style={[styles.meta, muted]}>
                                            {versionList.initialVersion}
                                        </Text>
                                    ) : (
                                        changedFields.length > 0 && (
                                            <Text numberOfLines={1} style={[styles.meta, muted]}>
                                                {fillTemplate(versionList.changedFields, {
                                                    fields: formatChangedFieldNames(changedFields, conflict),
                                                })}
                                            </Text>
                                        )
                                    )}
                                    {attribution !== undefined && (
                                        <Text style={[styles.meta, muted]}>{attribution}</Text>
                                    )}
                                    {version.changeSummary !== undefined && version.changeSummary.length > 0 && (
                                        <Text style={[styles.meta, muted]}>{version.changeSummary}</Text>
                                    )}
                                    {restoringVersion === version.versionNumber && (
                                        <Text accessibilityLiveRegion="polite" style={[styles.meta, muted]}>
                                            {fillTemplate(versionList.restoringStatus, {
                                                version: version.versionNumber,
                                            })}
                                        </Text>
                                    )}
                                </View>
                                {isCurrent ? (
                                    <Text
                                        style={[
                                            styles.badge,
                                            { backgroundColor: colors.selectedFill, color: colors.actionText },
                                        ]}
                                    >
                                        {versionList.currentBadge}
                                    </Text>
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
                            </View>
                        );
                    })}
                </View>
            )}
        </View>
    );
};

const styles = StyleSheet.create({
    container: { gap: nativeTokens.spacing[4], paddingBottom: nativeTokens.spacing[6] },
    alert: {
        marginHorizontal: nativeTokens.spacing[4],
        borderRadius: nativeTokens.radius.md,
        padding: nativeTokens.spacing[3],
    },
    empty: {
        alignItems: 'center',
        gap: nativeTokens.spacing[3],
        paddingVertical: nativeTokens.spacing[8],
        paddingHorizontal: nativeTokens.spacing[4],
    },
    emptyTitle: { ...nativeTokens.type.sectionTitle, textAlign: 'center' },
    body: { ...nativeTokens.type.body, textAlign: 'center' },
    row: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: nativeTokens.spacing[3],
        paddingHorizontal: nativeTokens.spacing[4],
        paddingVertical: nativeTokens.spacing[3],
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    rowText: { flex: 1, minWidth: 0, gap: 2 },
    rowTitle: { ...nativeTokens.type.cardTitle },
    meta: { ...nativeTokens.type.meta },
    badge: {
        ...nativeTokens.type.caption,
        borderRadius: nativeTokens.radius.sm,
        paddingHorizontal: nativeTokens.spacing[2],
        paddingVertical: 2,
        overflow: 'hidden',
    },
});
