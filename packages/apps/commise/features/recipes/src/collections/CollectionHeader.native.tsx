/**
 * @module @commise/features-recipes/collections — the native collection header (W5 Task 6; slice 5 of the UI overhaul),
 * the twin of the web leaf (`docs/design/uiOverhaul/buildSpec.md` §5.2): "‹ Collections" back, the name as the screen's
 * large title, the meta line — visibility as an icon and a word, "6 recipes" and, for a copy, "Copied from @clara" — the
 * description, and ONE primary (Add recipes) with ONE ⋯ menu named for the collection (a sheet on native): Rename · Make
 * private / Make public · Save a copy · Pull updates (copies only) · divider · Delete collection.
 *
 * The pair sits at the end of the title row from a 600 container and under the description below it, decided by the host
 * (`actionsPlacement`), and is drawn once. Colour is read from the theme at render (D15).
 *
 * @pattern Composite — the title, meta, description and actions of one collection
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { ActionMenu } from '@commise/ui/action-menu';
import { Button } from '@commise/ui/button';
import { Icon } from '@commise/ui/icon';
import { LargeTitleHeader } from '@commise/ui/large-title-header';
import { nativeTokens } from '@commise/ui/native';
import { RefreshNotice } from '@commise/ui/refresh-notice';
import { useTheme } from '@commise/ui/theme';
import { RecipeVisibility } from '@kitchensink/recipe-core';
import type { FC, ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { formatRecipeCount } from '../list/model.js';
import { fillTemplate } from '../format/fillTemplate.js';
import type { CollectionHeaderProps } from './detailModel.js';
import { collectionMessages } from './messages.js';
import { formatCollectionDate } from './model.js';

export const CollectionHeader: FC<CollectionHeaderProps> = ({
    name,
    description,
    visibility,
    recipeCount,
    sourceCollectionName,
    sourceOwnerHandle,
    sourceCollectionId,
    lastPulledAt,
    actionsPlacement,
    headingId,
    headingFocusSignal,
    onBack,
    onAddRecipes,
    onViewSource,
    refreshNotice,
    onRename,
    onToggleVisibility,
    onSaveCopy,
    onPullUpdates,
    onDelete,
}) => {
    const { detail, list, menu: copy, header } = useMessages(collectionMessages);
    const locale = useLocale();
    const { colors } = useTheme();
    const isPublic = visibility === RecipeVisibility.PUBLIC;
    const isCopy = sourceCollectionName !== undefined || sourceCollectionId !== undefined;
    // A retry from the refresh notice that succeeds removes the button the viewer pressed, so the cursor goes to the name.
    const focusSignal = headingFocusSignal + (refreshNotice?.recoveries ?? 0);

    const copiedFrom =
        sourceOwnerHandle !== undefined
            ? fillTemplate(detail.copiedFrom, { handle: sourceOwnerHandle })
            : sourceCollectionName !== undefined
              ? fillTemplate(detail.copiedFromNamed, { name: sourceCollectionName })
              : detail.copiedFromUnknown;

    const add = (
        <Button icon="plus" width={actionsPlacement === 'below' ? 'fill' : 'auto'} onPress={onAddRecipes}>
            {detail.addRecipeCta}
        </Button>
    );
    const menu = (
        <ActionMenu
            triggerLabel={fillTemplate(copy.moreActions, { name })}
            title={name}
            closeLabel={copy.close}
            items={[
                { id: 'rename', label: copy.rename, onSelect: onRename },
                {
                    id: 'visibility',
                    label: isPublic ? copy.makePrivate : copy.makePublic,
                    onSelect: onToggleVisibility,
                },
                { id: 'saveCopy', label: copy.saveCopy, onSelect: onSaveCopy },
                ...(isCopy ? [{ id: 'pull', label: copy.pullUpdates, onSelect: onPullUpdates }] : []),
            ]}
            destructiveItem={{ id: 'delete', label: copy.delete, onSelect: onDelete }}
        />
    );

    const metaItem = (key: string, children: ReactNode): ReactNode => (
        <View key={key} style={styles.metaItem}>
            {children}
        </View>
    );
    const metaText = [styles.meta, { color: colors.inkMuted }];

    return (
        <View style={styles.stack}>
            <LargeTitleHeader
                headingId={headingId}
                title={name}
                focusSignal={focusSignal}
                back={{
                    label: fillTemplate(detail.backTo, { parent: list.heading }),
                    parent: list.heading,
                    onPress: onBack,
                }}
                {...(actionsPlacement === 'title' ? { action: { kind: 'controls', button: add, menu } } : {})}
            />
            <View style={styles.metaRow}>
                {metaItem(
                    'visibility',
                    <>
                        <Icon name={isPublic ? 'globe' : 'lock'} size={16} tone="inkMuted" />
                        <Text style={metaText}>{isPublic ? detail.visibilityPublic : detail.visibilityPrivate}</Text>
                    </>,
                )}
                {metaItem(
                    'count',
                    <Text style={metaText}>
                        {formatRecipeCount(
                            recipeCount,
                            { one: detail.recipeCountOne, other: detail.recipeCountOther },
                            locale,
                        )}
                    </Text>,
                )}
                {isCopy
                    ? metaItem(
                          'source',
                          onViewSource !== undefined && sourceCollectionId !== undefined ? (
                              <Pressable
                                  role="button"
                                  aria-label={copiedFrom}
                                  onPress={() => onViewSource(sourceCollectionId)}
                                  style={styles.link}
                              >
                                  <Text style={[styles.meta, { color: colors.actionText }]}>{copiedFrom}</Text>
                              </Pressable>
                          ) : (
                              <Text style={metaText}>{copiedFrom}</Text>
                          ),
                      )
                    : null}
            </View>
            {lastPulledAt === undefined ? null : (
                <Text style={[styles.caption, { color: colors.inkMuted }]}>
                    {fillTemplate(header.lastPulled, { date: formatCollectionDate(lastPulledAt, locale) })}
                </Text>
            )}
            {description === undefined || description === '' ? null : (
                <Text style={[styles.body, { color: colors.ink }]}>{description}</Text>
            )}
            {actionsPlacement === 'below' ? (
                <View style={styles.actions}>
                    <View style={styles.grow}>{add}</View>
                    {menu}
                </View>
            ) : null}
            {refreshNotice === undefined ? null : (
                <RefreshNotice
                    failed={refreshNotice.failed}
                    refreshing={refreshNotice.refreshing}
                    onRetry={refreshNotice.onRetry}
                    labels={{ failed: detail.refreshError, retry: detail.refreshRetry }}
                />
            )}
        </View>
    );
};

const styles = StyleSheet.create({
    stack: { gap: nativeTokens.spacing[3] },
    metaRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        columnGap: nativeTokens.spacing[3],
        rowGap: 4,
    },
    metaItem: { flexDirection: 'row', alignItems: 'center', gap: nativeTokens.spacing[1] },
    link: { minHeight: 24, justifyContent: 'center' },
    meta: { ...nativeTokens.type.meta },
    caption: { ...nativeTokens.type.caption },
    body: { ...nativeTokens.type.body },
    actions: { flexDirection: 'row', alignItems: 'center', gap: nativeTokens.spacing[2] },
    grow: { flex: 1, minWidth: 0 },
});
