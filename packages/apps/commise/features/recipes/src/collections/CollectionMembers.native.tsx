/**
 * @module @commise/features-recipes/collections — the native member list of a collection detail, the twin of the web leaf
 * (`docs/design/uiOverhaul/buildSpec.md` §5.2): "6 recipes" with the list/grid switch it shares with My recipes, the
 * members as cards in the variant the host decided, "Load more ({n} more)" past the reveal window, the empty state "No
 * recipes here yet" with Add recipes, and an alert when a committed removal failed.
 *
 * It lays the members out itself rather than in a virtualised list: the reveal window keeps the count to a handful, and
 * the detail screen already scrolls (a list inside a scroll view cannot virtualise). When the last row is removed the host
 * advances the heading's focus signal, since native has no element to focus by id. Colour is read from the theme (D15).
 *
 * Presentational: it fetches nothing and sends nothing; the host decides the view and runs the removals.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { contentWidthOf } from '@commise/ui/container-class';
import { nativeTokens } from '@commise/ui/native';
import { SegmentedControl } from '@commise/ui/segmented-control';
import { useTheme } from '@commise/ui/theme';
import { useState, type FC } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { GRID_GAP, libraryGridColumnsOf } from '../card/cardGridLayout.js';
import { LIST_VIEW_MODES, isListViewMode } from '../card/cardVariant.js';
import { formatRecipeCount } from '../list/model.js';
import { fillTemplate } from '../format/fillTemplate.js';
import { CollectionMemberRow } from './CollectionMemberRow.native.js';
import { MEMBER_WINDOW_SIZE, type CollectionMembersProps } from './detailModel.js';
import { collectionMessages } from './messages.js';

/**
 * A cell's width as a share of the row. React Native types a percentage as a template string, which a computed one is not.
 *
 * @param columns - How many cells share a row.
 * @returns The width.
 */
function columnWidthOf(columns: number): `${number}%` {
    return `${100 / columns}%`;
}

export const CollectionMembers: FC<CollectionMembersProps> = ({
    members,
    viewMode,
    onViewModeChange,
    variant,
    onSelectRecipe,
    onRemoveRecipe,
    onAddRecipes,
    removeFailedTitle,
    renderNutrition,
}) => {
    const { detail, member: copy } = useMessages(collectionMessages);
    const locale = useLocale();
    const { colors } = useTheme();
    const { width } = useWindowDimensions();
    const [revealCount, setRevealCount] = useState(MEMBER_WINDOW_SIZE);
    const visible = members.slice(0, revealCount);
    const remaining = members.length - visible.length;
    const columns = variant === 'row' ? 1 : variant === 'compact' ? 2 : libraryGridColumnsOf(contentWidthOf(width));

    return (
        <View collapsable={false} role="region" aria-label={detail.membersHeading} style={styles.section}>
            {removeFailedTitle === undefined ? null : (
                <Text role="alert" style={[styles.body, { color: colors.dangerText }]}>
                    {fillTemplate(copy.removeFailed, { title: removeFailedTitle })}
                </Text>
            )}
            {members.length === 0 ? (
                <View style={styles.empty}>
                    <Text role="heading" aria-level={2} style={[styles.sectionTitle, { color: colors.ink }]}>
                        {detail.emptyTitle}
                    </Text>
                    <Text style={[styles.body, { color: colors.inkMuted }]}>{detail.emptyBody}</Text>
                    <Button icon="plus" onPress={onAddRecipes}>
                        {detail.addRecipeCta}
                    </Button>
                </View>
            ) : (
                <>
                    <View style={styles.bar}>
                        <Text style={[styles.count, { color: colors.ink }]}>
                            {formatRecipeCount(
                                members.length,
                                { one: detail.recipeCountOne, other: detail.recipeCountOther },
                                locale,
                            )}
                        </Text>
                        {/* A fixed width: icon-only segments grow to fill their track, and a row gives them no bound. */}
                        <View style={styles.viewSwitch}>
                            <SegmentedControl
                                form="view"
                                label={detail.viewLabel}
                                labelVisibility="hidden"
                                value={viewMode}
                                onChange={(mode) => {
                                    if (isListViewMode(mode)) {
                                        onViewModeChange(mode);
                                    }
                                }}
                                segments={LIST_VIEW_MODES.map((mode) => ({
                                    id: mode,
                                    label: mode === 'list' ? detail.viewList : detail.viewGrid,
                                    icon: mode === 'list' ? 'list' : 'layoutGrid',
                                }))}
                            />
                        </View>
                    </View>
                    <View collapsable={false} role="list" style={[styles.cards, columns > 1 && styles.cardsGrid]}>
                        {visible.map((member) => (
                            <View
                                key={member.id}
                                collapsable={false}
                                role="listitem"
                                style={{
                                    width: columnWidthOf(columns),
                                    paddingHorizontal: columns > 1 ? GRID_GAP / 2 : 0,
                                }}
                            >
                                <CollectionMemberRow
                                    member={member}
                                    variant={variant}
                                    onSelect={onSelectRecipe}
                                    onRemove={onRemoveRecipe}
                                    nutrition={renderNutrition?.(member.id)}
                                />
                            </View>
                        ))}
                    </View>
                    {remaining > 0 && (
                        // W5/C7 — client-side member-list windowing (no member-pagination endpoint).
                        <View style={styles.more}>
                            <Button
                                variant="secondary"
                                icon="chevronDown"
                                onPress={() =>
                                    setRevealCount((count) => Math.min(members.length, count + MEMBER_WINDOW_SIZE))
                                }
                            >
                                {fillTemplate(detail.loadMore, { count: remaining })}
                            </Button>
                        </View>
                    )}
                </>
            )}
        </View>
    );
};

const styles = StyleSheet.create({
    section: { gap: nativeTokens.spacing[3] },
    empty: { alignItems: 'flex-start', gap: nativeTokens.spacing[3], paddingVertical: nativeTokens.spacing[6] },
    bar: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        columnGap: nativeTokens.spacing[3],
        rowGap: nativeTokens.spacing[2],
    },
    viewSwitch: { width: 112 },
    cards: { flexDirection: 'row', flexWrap: 'wrap', rowGap: nativeTokens.spacing[2] },
    cardsGrid: { marginHorizontal: -GRID_GAP / 2, rowGap: GRID_GAP },
    more: { alignSelf: 'center' },
    count: { ...nativeTokens.type.label, fontVariant: ['tabular-nums', 'lining-nums'] },
    sectionTitle: { ...nativeTokens.type.sectionTitle },
    body: { ...nativeTokens.type.body },
});
