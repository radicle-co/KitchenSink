/**
 * @module @commise/features-recipes — native recipe version-history view (T069 building block).
 *
 * The React Native leaf of {@link import('./RecipeVersionList.js').RecipeVersionList} — same controlled,
 * presentational contract (newest-first, current version marked and not restorable, busy state on the
 * version being restored with all restore actions disabled, empty state) rendered with RN primitives.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import type { FC } from 'react';
import { Pressable, Text, View } from 'react-native';

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
            <View accessibilityLabel={versionList.heading}>
                <Text accessibilityRole="header">{versionList.heading}</Text>
                <Text>{versionList.empty}</Text>
            </View>
        );
    }

    return (
        <View accessibilityLabel={versionList.heading}>
            <Text accessibilityRole="header">{versionList.heading}</Text>
            {sortVersionsDescending(versions).map((version) => {
                const isCurrent = version.versionNumber === currentVersion;
                const isBusy = restoringVersion === version.versionNumber;

                return (
                    <View key={version.id}>
                        <Text>{fillTemplate(versionList.versionLabel, { version: version.versionNumber })}</Text>
                        <Text>{formatVersionTimestamp(version.createdAt, locale)}</Text>
                        {version.changeSummary !== undefined && version.changeSummary.length > 0 && (
                            <Text>{version.changeSummary}</Text>
                        )}
                        {isCurrent ? (
                            <Text>{versionList.currentBadge}</Text>
                        ) : (
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel={fillTemplate(versionList.restoreAction, {
                                    version: version.versionNumber,
                                })}
                                accessibilityState={{ disabled: isRestoring, busy: isBusy }}
                                disabled={isRestoring}
                                onPress={() => onRestore(version.versionNumber)}
                            >
                                <Text>{versionList.restore}</Text>
                            </Pressable>
                        )}
                        {isBusy && (
                            <Text accessibilityLiveRegion="polite">
                                {fillTemplate(versionList.restoringStatus, { version: version.versionNumber })}
                            </Text>
                        )}
                    </View>
                );
            })}
        </View>
    );
};
