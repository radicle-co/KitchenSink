/**
 * @module @commise/features-recipes — native clone-info panel (W5 Task 8 building block).
 *
 * The React Native leaf of {@link import('./CloneInfoPanel.js').CloneInfoPanel} — same presentational
 * contract (source `@owner / "name"` attribution, cloned date, View Source) rendered with RN primitives.
 */
import { useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import type { FC } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { fillTemplate } from '../list/model.js';
import { collectionMessages } from './messages.js';
import { formatCollectionDate, type CloneInfoPanelProps } from './model.js';

export const CloneInfoPanel: FC<CloneInfoPanelProps> = ({
    sourceOwnerHandle,
    sourceCollectionName,
    sourceCollectionId,
    clonedAt,
    locale,
    onViewSource,
}) => {
    const { cloneInfo } = useMessages(collectionMessages);

    // `sourceCollectionName`/`sourceOwnerHandle` are frozen at clone time and may independently be absent
    // (unresolved owner, or a source deleted after cloning) — the attribution degrades name-only, then to a
    // generic fallback, rather than leaking `undefined` into the DOM (mirrors CollectionHeader's
    // `sourceAttribution`/`sourceAttributionNoHandle` handling of the same provenance fields).
    const attribution =
        sourceCollectionName === undefined
            ? cloneInfo.clonedFromUnknown
            : sourceOwnerHandle === undefined
              ? fillTemplate(cloneInfo.clonedFromNoHandle, { name: sourceCollectionName })
              : fillTemplate(cloneInfo.clonedFrom, { handle: sourceOwnerHandle, name: sourceCollectionName });
    const clonedOnLabel = fillTemplate(cloneInfo.clonedOn, { date: formatCollectionDate(clonedAt, locale) });

    return (
        <View accessibilityLabel={cloneInfo.heading} style={styles.container}>
            <Text style={styles.heading}>{cloneInfo.heading}</Text>
            <Text style={styles.attribution}>{attribution}</Text>
            <Text style={styles.meta}>{clonedOnLabel}</Text>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={cloneInfo.viewSource}
                onPress={() => onViewSource(sourceCollectionId)}
                style={styles.textButton}
            >
                <Text style={styles.viewSourceLabel}>{cloneInfo.viewSource}</Text>
            </Pressable>
        </View>
    );
};

const styles = StyleSheet.create({
    container: { gap: 8, padding: 20, borderRadius: 16, backgroundColor: palette.white },
    heading: { fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, color: palette.slate },
    attribution: { fontSize: 14, color: palette.charcoal },
    meta: { fontSize: 14, color: palette.slate },
    textButton: { alignSelf: 'flex-start', paddingVertical: 6, paddingHorizontal: 10 },
    // `ocean-dark`, not `seafoam`: seafoam as a text foreground is 4.02:1 on this panel's white surface, under
    // the 4.5:1 body-text floor (see the palette JSDoc in `@commise/ui` for the accent-vs-text rule).
    viewSourceLabel: { color: palette['ocean-dark'], fontWeight: '500', fontSize: 14 },
});
