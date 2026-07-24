/**
 * @module @commise/features-recipes — native collection-header view (W5 Task 6 building block).
 *
 * The React Native leaf of {@link import('./CollectionHeader.js').CollectionHeader} — same presentational
 * contract (name + Edit/Delete, visibility badge, recipe count, source attribution, last-pulled, Back)
 * rendered with RN primitives.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import type { FC } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { fillTemplate, formatRecipeCount } from '../list/model.js';
import { collectionMessages } from './messages.js';
import { formatCollectionDate, type CollectionHeaderViewProps } from './model.js';

export const CollectionHeader: FC<CollectionHeaderViewProps> = ({
    name,
    description,
    visibility,
    recipeCount,
    sourceCollectionName,
    sourceOwnerHandle,
    lastPulledAt,
    onBack,
    onEdit,
    onDelete,
}) => {
    const { header, detail } = useMessages(collectionMessages);
    const locale = useLocale();

    const visibilityLabel = visibility === 'public' ? header.visibilityPublic : header.visibilityPrivate;
    const recipeCountLabel = formatRecipeCount(
        recipeCount,
        { one: header.recipeCountOne, other: header.recipeCountOther },
        locale,
    );
    // FR-011 — attribution is shown only for a cloned collection (`sourceCollectionName` present); the
    // source owner handle may still be unresolved, in which case the template drops the `@handle` segment
    // rather than rendering a broken/partial mention.
    const sourceAttribution =
        sourceCollectionName === undefined
            ? undefined
            : sourceOwnerHandle === undefined
              ? fillTemplate(header.sourceAttributionNoHandle, { name: sourceCollectionName })
              : fillTemplate(header.sourceAttribution, { handle: sourceOwnerHandle, name: sourceCollectionName });
    const lastPulledLabel =
        lastPulledAt === undefined
            ? undefined
            : fillTemplate(header.lastPulled, { date: formatCollectionDate(lastPulledAt, locale) });

    return (
        <View accessibilityLabel={name} style={styles.container}>
            {onBack !== undefined && (
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={header.backToCollections}
                    onPress={onBack}
                    style={styles.textButton}
                >
                    <Text style={styles.backLabel}>{header.backToCollections}</Text>
                </Pressable>
            )}
            <View style={styles.titleRow}>
                <Text accessibilityRole="header" style={styles.heading}>
                    {name}
                </Text>
                <View style={styles.actions}>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={detail.renameCta}
                        onPress={onEdit}
                        style={styles.textButton}
                    >
                        <Text style={styles.editLabel}>{detail.renameCta}</Text>
                    </Pressable>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={detail.deleteCta}
                        onPress={onDelete}
                        style={styles.textButton}
                    >
                        <Text style={styles.deleteLabel}>{detail.deleteCta}</Text>
                    </Pressable>
                </View>
            </View>
            {description !== undefined && description.length > 0 && (
                <Text style={styles.description}>{description}</Text>
            )}
            <View style={styles.metaRow}>
                <Text style={styles.badge}>{visibilityLabel}</Text>
                <Text style={styles.meta}>{recipeCountLabel}</Text>
            </View>
            {sourceAttribution !== undefined && <Text style={styles.meta}>{sourceAttribution}</Text>}
            {lastPulledLabel !== undefined && <Text style={styles.meta}>{lastPulledLabel}</Text>}
        </View>
    );
};

const styles = StyleSheet.create({
    container: { gap: 8, paddingHorizontal: 16, paddingVertical: 16 },
    textButton: { paddingVertical: 6, paddingHorizontal: 10 },
    backLabel: { color: palette.seafoam, fontWeight: '500', fontSize: 14 },
    titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
    heading: { fontSize: 28, fontWeight: '700', color: palette.charcoal },
    actions: { flexDirection: 'row', gap: 8 },
    editLabel: { color: palette.seafoam, fontWeight: '500', fontSize: 14 },
    deleteLabel: { color: palette.error, fontWeight: '500', fontSize: 14 },
    description: { fontSize: 15, color: palette.slate },
    metaRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    badge: {
        // 10%-alpha tint of `palette.seafoam` (#3D8B85 → rgb(61, 139, 133)) — mirrors the web leaf's
        // `bg-seafoam/10` Tailwind utility; RN has no alpha-suffix color syntax, so it is spelled out here.
        backgroundColor: 'rgba(61, 139, 133, 0.1)',
        color: palette.seafoam,
        fontWeight: '500',
        fontSize: 12,
        borderRadius: 999,
        paddingVertical: 4,
        paddingHorizontal: 10,
    },
    meta: { fontSize: 13, color: palette.slate },
});
