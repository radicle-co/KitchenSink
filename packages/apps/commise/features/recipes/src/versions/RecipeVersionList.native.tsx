/**
 * @module @commise/features-recipes — native recipe version-history view (T069 building block).
 *
 * The React Native leaf of {@link import('./RecipeVersionList.js').RecipeVersionList} — same controlled,
 * presentational contract (newest-first, current version marked and not restorable, busy state on the
 * version being restored with all restore actions disabled, empty state) rendered with RN primitives.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import type { FC } from 'react';
import { palette } from '@commise/ui';
import { Pressable, StyleSheet, Text, View } from 'react-native';

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
            <View accessibilityLabel={versionList.heading} style={styles.container}>
                <Text accessibilityRole="header" style={styles.heading}>
                    {versionList.heading}
                </Text>
                <Text style={styles.muted}>{versionList.empty}</Text>
            </View>
        );
    }

    return (
        <View accessibilityLabel={versionList.heading} style={styles.container}>
            <Text accessibilityRole="header" style={styles.heading}>
                {versionList.heading}
            </Text>
            {sortVersionsDescending(versions).map((version) => {
                const isCurrent = version.versionNumber === currentVersion;
                const isBusy = restoringVersion === version.versionNumber;

                return (
                    <View key={version.id} style={styles.row}>
                        <View style={styles.rowHeader}>
                            <Text style={styles.versionLabel}>
                                {fillTemplate(versionList.versionLabel, { version: version.versionNumber })}
                            </Text>
                            {isCurrent ? (
                                <Text style={styles.currentBadge}>{versionList.currentBadge}</Text>
                            ) : (
                                <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel={fillTemplate(versionList.restoreAction, {
                                        version: version.versionNumber,
                                    })}
                                    accessibilityState={{ disabled: isRestoring, busy: isBusy }}
                                    disabled={isRestoring}
                                    onPress={() => onRestore(version.versionNumber)}
                                    style={styles.restoreButton}
                                >
                                    <Text style={styles.restoreLabel}>{versionList.restore}</Text>
                                </Pressable>
                            )}
                        </View>
                        <Text style={styles.muted}>{formatVersionTimestamp(version.createdAt, locale)}</Text>
                        {version.changeSummary !== undefined && version.changeSummary.length > 0 && (
                            <Text style={styles.muted}>{version.changeSummary}</Text>
                        )}
                        {isBusy && (
                            <Text accessibilityLiveRegion="polite" style={styles.muted}>
                                {fillTemplate(versionList.restoringStatus, { version: version.versionNumber })}
                            </Text>
                        )}
                    </View>
                );
            })}
        </View>
    );
};

const styles = StyleSheet.create({
    container: { gap: 12, paddingHorizontal: 16, paddingVertical: 16 },
    heading: { fontSize: 20, fontWeight: '600', color: palette.charcoal },
    muted: { fontSize: 13, color: palette.slate },
    row: {
        backgroundColor: palette.white,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: 'rgba(178, 190, 195, 0.3)',
        padding: 14,
        gap: 4,
    },
    rowHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    versionLabel: { fontSize: 16, fontWeight: '600', color: palette.charcoal },
    currentBadge: { fontSize: 12, fontWeight: '500', color: palette.seafoam },
    restoreButton: { borderRadius: 999, paddingVertical: 6, paddingHorizontal: 14 },
    restoreLabel: { color: palette.seafoam, fontWeight: '500', fontSize: 14 },
});
