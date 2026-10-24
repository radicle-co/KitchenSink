/**
 * @module @commise/features-recipes/collections — the native collection header (W5 Task 6; slice 5 of the UI overhaul),
 * the twin of the web leaf (`docs/design/uiOverhaul/buildSpec.md` §5.2): the name as the screen's large title, the meta
 * line — visibility as an icon and a word, "6 recipes" and, for a copy, "Copied from @clara" — the description, and ONE
 * primary (Add recipes).
 *
 * It draws NO Back and NO ⋯ menu: on native both are in the screen's pinned bar (`docs/design/uiRefreshWorkshop5/
 * pinnedBackBar.md` §7), the menu as `CollectionMoreMenu`. Their props stay because the web header, which shares this
 * contract, draws both.
 *
 * Add recipes sits at the end of the title row from a 600 container and under the description below it, decided by the
 * host (`actionsPlacement`), and is drawn once. Colour is read from the theme at render (D15).
 *
 * @pattern Composite — the title, meta, description and actions of one collection
 */
import { useLocale, useMessages } from '@commise/i18n/react';
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
import { isCollectionCopy, type CollectionHeaderProps } from './detailModel.js';
import { collectionMessages } from './messages.js';
import { bylineMessages } from '../byline/messages.js';
import { sourceOwnerBylineText } from './sourceOwnerByline.js';
import { formatCollectionDate } from './model.js';

export const CollectionHeader: FC<CollectionHeaderProps> = ({
    name,
    description,
    visibility,
    recipeCount,
    sourceCollectionName,
    sourceOwnerDisplayName,
    sourceOwnerUsername,
    sourceCollectionId,
    lastPulledAt,
    actionsPlacement,
    headingId,
    headingFocusSignal,
    onAddRecipes,
    onViewSource,
    refreshNotice,
}) => {
    const { detail, header } = useMessages(collectionMessages);
    const bylineCopy = useMessages(bylineMessages);
    const locale = useLocale();
    const { colors } = useTheme();
    const isPublic = visibility === RecipeVisibility.PUBLIC;
    const isCopy = isCollectionCopy({ sourceCollectionName, sourceCollectionId });
    // A retry from the refresh notice that succeeds removes the button the viewer pressed, so the cursor goes to the name.
    const focusSignal = headingFocusSignal + (refreshNotice?.recoveries ?? 0);

    const owner = sourceOwnerBylineText(
        {
            ...(sourceOwnerUsername === undefined ? {} : { sourceOwnerUsername }),
            ...(sourceOwnerDisplayName === undefined ? {} : { sourceOwnerDisplayName }),
        },
        bylineCopy,
        'sentence',
    );
    const copiedFrom =
        owner !== undefined
            ? fillTemplate(detail.copiedFrom, { byline: owner })
            : sourceCollectionName !== undefined
              ? fillTemplate(detail.copiedFromNamed, { name: sourceCollectionName })
              : detail.copiedFromUnknown;

    const add = (
        <Button icon="plus" width={actionsPlacement === 'below' ? 'fill' : 'auto'} onPress={onAddRecipes}>
            {detail.addRecipeCta}
        </Button>
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
                {...(actionsPlacement === 'title' ? { action: { kind: 'controls', button: add } } : {})}
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
            {actionsPlacement === 'below' ? add : null}
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
});
