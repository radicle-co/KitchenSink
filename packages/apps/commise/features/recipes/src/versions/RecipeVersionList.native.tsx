/**
 * @module @commise/features-recipes — native recipe version-history view (T069 building block).
 *
 * The React Native leaf of `RecipeVersionList` — same controlled,
 * presentational contract (newest-first, editor attribution, computed changed-fields summary, Preview
 * action, current version marked and not restorable, busy state on the version being restored with all
 * restore actions disabled, empty state) rendered with RN primitives. `onBack` is intentionally NOT read
 * here — native screens (`RecipeVersionsScreen`) already compose their own back chrome outside this shared
 * component, so this leaf renders no back affordance (see the web leaf's `VersionListHeader` for the V6 fix).
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import type { FC } from 'react';
import { palette } from '@commise/ui';
import { Pressable, StyleSheet, Text, View } from 'react-native';

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

export const RecipeVersionList: FC<RecipeVersionListProps> = ({
    versions,
    currentVersion,
    restoringVersion,
    restoreError,
    onRestore,
    onPreview,
    selectedForCompare,
    onToggleCompare,
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
            {restoreErrorMessage !== undefined && (
                <Text accessibilityRole="alert" style={styles.restoreError}>
                    {restoreErrorMessage}
                </Text>
            )}
            {sortVersionsDescending(versions).map((version) => {
                const isCurrent = version.versionNumber === currentVersion;
                const isBusy = restoringVersion === version.versionNumber;
                const attribution = formatVersionAttribution(version.editorHandle, versionList);
                const { hasPrior, changedFields } = changeSummaryForVersion(versions, version);

                return (
                    <View key={version.id} style={styles.row}>
                        <View style={styles.rowHeader}>
                            <Text style={styles.versionLabel}>
                                {fillTemplate(versionList.versionLabel, { version: version.versionNumber })}
                            </Text>
                            {isCurrent ? (
                                <Text style={styles.currentBadge}>{versionList.currentBadge}</Text>
                            ) : (
                                <View style={styles.rowActions}>
                                    {onPreview !== undefined && (
                                        <Pressable
                                            accessibilityRole="button"
                                            accessibilityLabel={fillTemplate(versionList.previewAction, {
                                                version: version.versionNumber,
                                            })}
                                            onPress={() => onPreview(version.versionNumber)}
                                            style={styles.previewButton}
                                        >
                                            <Text style={styles.previewLabel}>{versionList.preview}</Text>
                                        </Pressable>
                                    )}
                                    <Pressable
                                        accessibilityRole="button"
                                        accessibilityLabel={fillTemplate(versionList.restoreAction, {
                                            version: version.versionNumber,
                                        })}
                                        // `disabled` already reaches the DOM (RNW derives `aria-disabled` from
                                        // the `disabled` prop below), but `busy` does not — react-native-web
                                        // projects `accessibilityState` to no attribute at all (#123). RN
                                        // declares `aria-busy` as a first-class ALIAS for
                                        // `accessibilityState.busy`, so the alias is device-correct as well as
                                        // DOM-observable. Omitted while idle: ARIA already defaults `aria-busy`
                                        // to false, so an always-present `false` on every row is noise.
                                        accessibilityState={{ disabled: isRestoring, busy: isBusy }}
                                        aria-busy={isBusy || undefined}
                                        disabled={isRestoring}
                                        onPress={() => onRestore(version.versionNumber)}
                                        style={styles.restoreButton}
                                    >
                                        <Text style={styles.restoreLabel}>{versionList.restore}</Text>
                                    </Pressable>
                                </View>
                            )}
                        </View>
                        {onToggleCompare !== undefined &&
                            (() => {
                                const isSelected = selectedForCompare?.includes(version.versionNumber) ?? false;
                                const isCapped = !isSelected && (selectedForCompare?.length ?? 0) >= 2;

                                return (
                                    <Pressable
                                        accessibilityRole="checkbox"
                                        accessibilityLabel={fillTemplate(versionList.compareAction, {
                                            version: version.versionNumber,
                                        })}
                                        // Both state forms are load-bearing, neither is redundant (#123).
                                        // `accessibilityState.checked` is the DEVICE trait VoiceOver/TalkBack
                                        // read; `aria-checked` is the only one that reaches the DOM —
                                        // react-native-web forwards literal `aria-*` props and projects
                                        // `accessibilityState` for NOTHING, so the object form alone left this
                                        // `role="checkbox"` with no state attribute at all on the web build,
                                        // which for a checkbox is its whole meaning. `aria-checked` (not
                                        // `aria-selected`, which ARIA allows only on
                                        // `option`/`tab`/`row`/`gridcell`-family roles, and not `aria-pressed`,
                                        // a toggle-BUTTON attribute) is the correct attribute here. Do not
                                        // "simplify" either away: RN reverse-maps `aria-checked` into
                                        // `accessibilityState.checked`, so dropping the object form would only
                                        // silence the device instead.
                                        accessibilityState={{ checked: isSelected, disabled: isCapped }}
                                        aria-checked={isSelected}
                                        disabled={isCapped}
                                        onPress={() => onToggleCompare(version.versionNumber)}
                                        style={styles.compareButton}
                                    >
                                        {/* The ☑/☐ glyph is the SIGHTED signal (never colour alone); the
                                            announced state is `aria-checked` above. */}
                                        <Text style={styles.compareLabel}>
                                            {isSelected ? '☑' : '☐'} {versionList.compare}
                                        </Text>
                                    </Pressable>
                                );
                            })()}
                        <Text style={styles.muted}>{formatVersionTimestamp(version.createdAt, locale)}</Text>
                        {attribution !== undefined && <Text style={styles.muted}>{attribution}</Text>}
                        {!hasPrior ? (
                            <Text style={styles.muted}>{versionList.initialVersion}</Text>
                        ) : (
                            changedFields.length > 0 && (
                                <Text style={styles.muted}>
                                    {fillTemplate(versionList.changedFields, {
                                        fields: formatChangedFieldNames(changedFields, conflict),
                                    })}
                                </Text>
                            )
                        )}
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
    rowActions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    versionLabel: { fontSize: 16, fontWeight: '600', color: palette.charcoal },
    currentBadge: { fontSize: 12, fontWeight: '500', color: palette['ocean-dark'] },
    previewButton: { borderRadius: 999, paddingVertical: 6, paddingHorizontal: 14 },
    previewLabel: { color: palette.slate, fontWeight: '500', fontSize: 14 },
    restoreButton: { borderRadius: 999, paddingVertical: 6, paddingHorizontal: 14 },
    restoreLabel: { color: palette['ocean-dark'], fontWeight: '500', fontSize: 14 },
    restoreError: { fontSize: 13, color: palette['error-dark'] },
    compareButton: { alignSelf: 'flex-start', borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10 },
    compareLabel: { color: palette.slate, fontWeight: '500', fontSize: 13 },
});
