/**
 * @module details/VariantDetailsDialog — the details dialog, native (curated U14; `docs/design/ingredientSpecialization.md`
 * §S8, §S10).
 *
 * A presentational leaf: it renders the state `useVariantDetailsDialog` derived, which the host passes in, on the
 * design-system bottom `Sheet`. A tap commits a row. The groups are header-role views over their rows, not a
 * `SectionList` (design decision V47). The loading text, "no matches" and the search count go through one `LiveRegion`.
 *
 * Focus (§S8.6): the Sheet puts the reading cursor on the title when it shows. Entering `error` moves it to the
 * alert text (design decision V48).
 *
 * @pattern Adapter over the design-system `Sheet` — the leaf maps each statechart state to the sheet's slots
 */
import { Icon } from '@commise/ui/icon';
import { offlineNoticeMessages } from '@commise/features-core/offline';
import { useLocale, useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { LiveRegion } from '@commise/ui/live-region';
import { nativeTokens } from '@commise/ui/native';
import { OfflineReadSlot } from '@commise/ui/offline-notice';
import { useScreenReaderFocusOnSignal } from '@commise/ui/screen-reader-focus';
import { Sheet } from '@commise/ui/sheet';
import { TextInput } from '@commise/ui/text-input';
import { useTheme } from '@commise/ui/theme';
import { VariantPartsLine } from '@commise/ui/variant-parts-line';
import { useState, type FC, type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { fillTemplate } from '../format/fillTemplate.js';
import { recipeMessages } from '../messages.js';
import { recipeNutritionMessages } from '../nutrition/messages.js';
import { type DetailsTextMessages, caloriesLabel, dialogViewOf, variantOptionName } from './detailsText.js';
import type { VariantRow } from './groupVariants.js';
import type { VariantDetailsDialogProps } from './props.js';
import { VariantOption } from './VariantOption.native.js';

/** A text with its first letter in upper case, as the web leaf's `first-letter:uppercase` draws it. Pure. */
function capitalised(text: string, locale: string): string {
    return text.charAt(0).toLocaleUpperCase(locale) + text.slice(1);
}

export const VariantDetailsDialog: FC<VariantDetailsDialogProps> = ({ open, foodName, details, onDismissed }) => {
    const locale = useLocale();
    const { ingredientDetails: copy } = useMessages(recipeMessages);
    const { calories } = useMessages(recipeNutritionMessages);
    const { readOffline } = useMessages(offlineNoticeMessages);
    const text: DetailsTextMessages = { details: copy, calories };
    const { state } = details;
    const { isLong, current, currentLine, total, announcement } = dialogViewOf(state, details.announcedCount, text);
    // Read once for every row: a row's parts basis follows the text size (§S8.2 "Row").
    const { fontScale } = useWindowDimensions();
    // Colour comes from the theme at render (D15): body copy in `ink`, the intro in `inkMuted`, the search field inside
    // a `lineControl` edge (the web twin's `border-line-control`), a loading row on `surfaceMuted`.
    const { colors } = useTheme();
    const ink = { color: colors.ink };
    const muted = { color: colors.inkMuted };

    // Entering `error` moves the reading cursor (§S8.6). Adjusted during render, React's previous-value form.
    const [seenState, setSeenState] = useState(state.name);
    const [errorSignal, setErrorSignal] = useState(0);

    if (state.name !== seenState) {
        setSeenState(state.name);

        if (state.name === 'error') {
            setErrorSignal((count) => count + 1);
        }
    }

    const alertRef = useScreenReaderFocusOnSignal<Text>(errorSignal);

    const optionFor = (row: VariantRow): ReactNode => {
        const isCurrent = current?.listed === true && current.variant.id === row.variant.id;

        return (
            <VariantOption
                key={row.variant.id}
                parts={row.shownParts}
                name={variantOptionName(row, isCurrent, locale, text)}
                calories={caloriesLabel(row.calories, locale, text).visible}
                isCurrent={isCurrent}
                currentTag={copy.tagCurrent}
                hasCheckColumn={current?.listed === true}
                fontScale={fontScale}
                onPick={() => details.onPick(row)}
            />
        );
    };

    const searchLabel = fillTemplate(copy.searchLabelOther, { count: total });
    const toolbar = isLong
        ? {
              heading: (
                  <View style={styles.labelRow}>
                      <Text style={[styles.searchLabel, ink]}>{searchLabel}</Text>
                      <Text style={[styles.caption, muted]}>{copy.caloriesBasis}</Text>
                  </View>
              ),
              controls: (
                  <View style={styles.searchRow}>
                      <TextInput
                          accessibilityLabel={searchLabel}
                          value={details.query}
                          onChangeText={details.onQueryChange}
                          autoCorrect={false}
                          autoCapitalize="none"
                          style={[styles.input, { borderColor: colors.lineControl, color: colors.ink }]}
                      />
                      {details.query !== '' && (
                          <Pressable
                              accessibilityRole="button"
                              accessibilityLabel={copy.searchClear}
                              onPress={details.onClearQuery}
                              style={styles.clear}
                          >
                              <Icon name="x" size={20} tone="inkMuted" />
                          </Pressable>
                      )}
                  </View>
              ),
          }
        : undefined;

    const footer =
        details.onRemove === undefined ? undefined : (
            <View style={styles.footer}>
                {state.name === 'detailsNoneLeft' && (
                    <Button variant="secondary" icon="x" onPress={details.onClose}>
                        {copy.dismiss}
                    </Button>
                )}
                <Button variant="secondary" icon="minus" onPress={details.onRemove}>
                    {copy.remove}
                </Button>
            </View>
        );

    const renderBody = (): ReactNode => {
        switch (state.name) {
            case 'loading':
                return (
                    <View style={styles.block}>
                        {/* Said once (§S12 row 17): Android reaches the polite region's own node, so the line is
                            hidden there; iOS hides that node, so the line is what VoiceOver reaches. */}
                        <Text aria-hidden={Platform.OS === 'android' ? true : undefined} style={[styles.body, ink]}>
                            {copy.loading}
                        </Text>
                        {[0, 1, 2].map((index) => (
                            <View
                                key={index}
                                aria-hidden
                                style={[styles.skeleton, { backgroundColor: colors.surfaceMuted }]}
                            />
                        ))}
                    </View>
                );
            case 'error':
                return (
                    <View style={styles.block}>
                        <Text ref={alertRef} accessibilityRole="alert" style={[styles.body, ink]}>
                            {copy.loadFailed}
                        </Text>
                        <View style={styles.retry}>
                            <Button variant="secondary" icon="refreshCw" onPress={details.onRetry}>
                                {copy.retry}
                            </Button>
                        </View>
                    </View>
                );
            case 'offline':
                return (
                    <View style={styles.block}>
                        <OfflineReadSlot message={readOffline} />
                    </View>
                );
            case 'noVariants':
                return (
                    <Text style={[styles.block, styles.body, ink]}>
                        {fillTemplate(copy.noVariants, { food: foodName })}
                    </Text>
                );
            case 'detailsNoneLeft':
                return (
                    <Text style={[styles.block, styles.body, ink]}>
                        {fillTemplate(copy.noneLeft, { food: foodName })}
                    </Text>
                );
            case 'combined':
                return <View>{state.rows.map(optionFor)}</View>;
            case 'noMatches':
                return (
                    <View style={styles.block}>
                        <Text style={[styles.body, ink]}>
                            {fillTemplate(copy.noMatches, { query: state.query, count: state.total })}
                        </Text>
                    </View>
                );
            case 'longList':
            case 'searching':
                return (
                    <View>
                        {state.plan.headless.map(optionFor)}
                        {state.plan.groups.map((group, index) => (
                            <View key={group.key}>
                                <Text
                                    accessibilityRole="header"
                                    style={[
                                        styles.groupHeader,
                                        ink,
                                        index === 0 && state.plan.headless.length === 0 ? styles.firstHeader : null,
                                    ]}
                                >
                                    {capitalised(group.key, locale)}
                                </Text>
                                {group.rows.map(optionFor)}
                            </View>
                        ))}
                    </View>
                );
        }
    };

    return (
        <Sheet
            open={open}
            onOpenChange={(next) => {
                if (!next) {
                    details.onClose();
                }
            }}
            onDismissed={onDismissed}
            title={details.mode === 'add' ? copy.actionAdd : copy.actionEdit}
            closeLabel={copy.close}
            size={isLong ? 'full' : 'content'}
            toolbar={toolbar}
            footer={footer}
        >
            <View style={styles.head}>
                <Text style={[styles.foodName, ink]}>{capitalised(foodName, locale)}</Text>
                <View style={styles.introRow}>
                    <Text style={[styles.intro, muted]}>{copy.intro}</Text>
                    {state.name === 'combined' && <Text style={[styles.caption, muted]}>{copy.caloriesBasis}</Text>}
                </View>
                {currentLine !== undefined && (
                    // A nested `VariantPartsLine` loses its own label, so this `Text` owns the spoken line.
                    <Text accessibilityLabel={currentLine.spoken} style={[styles.intro, muted]}>
                        <Text style={[styles.currentLabel, ink]}>{currentLine.before}</Text>
                        <VariantPartsLine parts={currentLine.parts} tone="secondary" />
                        {currentLine.after}
                    </Text>
                )}
            </View>
            {renderBody()}
            {/* One polite region, mounted before it speaks (`LiveRegion`'s own rule), so each change is heard. */}
            <LiveRegion politeness="polite" visuallyHidden>
                {announcement}
            </LiveRegion>
        </Sheet>
    );
};

const styles = StyleSheet.create({
    head: {
        gap: nativeTokens.spacing[1],
        paddingHorizontal: nativeTokens.spacing[4],
        paddingBottom: nativeTokens.spacing[4],
    },
    foodName: { fontSize: nativeTokens.fontSize.bodyMd, fontWeight: '600' },
    introRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        columnGap: nativeTokens.spacing[3],
    },
    intro: { fontSize: nativeTokens.fontSize.bodySm },
    caption: { fontSize: nativeTokens.fontSize.caption },
    currentLabel: { fontWeight: '600' },
    labelRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        columnGap: nativeTokens.spacing[3],
    },
    searchLabel: { fontSize: nativeTokens.fontSize.bodySm, fontWeight: '500' },
    searchRow: { flexDirection: 'row', alignItems: 'center', gap: nativeTokens.spacing[2] },
    input: {
        flex: 1,
        minHeight: 48,
        borderWidth: 1,
        borderRadius: nativeTokens.radius.md,
        paddingHorizontal: nativeTokens.spacing[3],
        fontSize: nativeTokens.fontSize.bodyMd,
    },
    clear: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
    block: { gap: nativeTokens.spacing[3], paddingHorizontal: nativeTokens.spacing[4] },
    body: { fontSize: nativeTokens.fontSize.bodyMd },
    retry: { alignSelf: 'flex-start' },
    skeleton: { height: 48, borderRadius: nativeTokens.radius.md },
    groupHeader: {
        paddingTop: nativeTokens.spacing[5],
        paddingBottom: nativeTokens.spacing[2],
        paddingHorizontal: nativeTokens.spacing[4],
        fontSize: nativeTokens.fontSize.bodySm,
        fontWeight: '600',
    },
    firstHeader: { paddingTop: nativeTokens.spacing[3] },
    footer: { gap: nativeTokens.spacing[3] },
});
