/**
 * @module @commise/features-recipes/ingredientMatching — `FoodChoiceList` (native): the React Native leaf of
 * `./FoodChoiceList.tsx`, on the same props and the same words (`matchLineView.ts`). Search for a food first, the options
 * in the server's order with the default tagged (`OptionLabel`), then Keep as written in the `quiet` tier last.
 *
 * Each option is a `Pressable` with the `button` role (staff-ux ruling 2026-10-25): VoiceOver and TalkBack read a radio
 * as "not selected", which implies a confirm step that does not exist. The bound food draws a check and its name ends
 * ", chosen"; no `selected` state as well, which would say it twice. While a pick is in flight every row is disabled
 * (a disabled `Pressable` keeps screen-reader focus on device) and the pressed one reads busy. The options' group keeps
 * its native node (`collapsable={false}`), or Android flattens it and its name — which marks where this line's list
 * starts — is lost (`docs/design/nativeContainerNames.md` N1 rule 5). Rows keep the native touch floor and every name
 * wraps, so nothing is cut off or scrolls sideways at 320 pt. Painted from the theme's roles (D15).
 */
import { Button } from '@commise/ui/button';
import { Icon } from '@commise/ui/icon';
import { nativeTokens } from '@commise/ui/native';
import { OptionLabel } from '@commise/ui/option-label';
import { useTheme } from '@commise/ui/theme';
import type { FC } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { FoodChoiceListProps } from './foodChoiceListProps.js';

/** A line's food-choice list: search, the options, Keep as written. */
export const FoodChoiceList: FC<FoodChoiceListProps> = ({ view, onSearch, onPick, searchFocus }) => {
    const { colors } = useTheme();

    return (
        <View style={styles.list}>
            {view.search.kind === 'available' ? (
                <Button
                    variant="ghost"
                    icon="search"
                    width="fill"
                    accessibilityLabel={view.search.name}
                    focusRequested={searchFocus.requested}
                    onFocusRequestHandled={searchFocus.onHandled}
                    onPress={onSearch}
                >
                    {view.search.label}
                </Button>
            ) : (
                <Text style={[styles.meta, { color: colors.inkMuted }]}>{view.search.text}</Text>
            )}
            <View collapsable={false} aria-label={view.optionsName}>
                {view.rows.map((row) => (
                    <Pressable
                        key={row.id}
                        accessibilityRole="button"
                        accessibilityLabel={row.name}
                        aria-busy={row.busy}
                        disabled={view.refusing}
                        onPress={() => {
                            onPick(row.pick);
                        }}
                        style={({ pressed }) => [
                            styles.row,
                            row.chosen && { backgroundColor: colors.selectedFill },
                            pressed && { backgroundColor: colors.surfaceMuted },
                        ]}
                    >
                        <OptionLabel
                            label={row.label}
                            textSize="list"
                            {...(row.tag === undefined ? {} : { tag: row.tag })}
                            {...(row.detailParts === undefined ? {} : { detailParts: row.detailParts })}
                        />
                        {row.chosen ? <Icon name="check" size={20} tone="actionText" /> : null}
                    </Pressable>
                ))}
                <View style={styles.keep}>
                    <Button
                        variant="quiet"
                        {...(view.keep.chosen ? { icon: 'check' as const } : {})}
                        accessibilityLabel={view.keep.name}
                        busy={view.keep.busy}
                        disabled={view.refusing && !view.keep.busy}
                        onPress={() => {
                            onPick(view.keep.pick);
                        }}
                    >
                        {view.keep.label}
                    </Button>
                    <Text style={[styles.meta, styles.hint, { color: colors.inkMuted }]}>{view.keep.hint}</Text>
                </View>
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    list: { gap: nativeTokens.spacing[2] },
    row: {
        minHeight: nativeTokens.touchTarget,
        flexDirection: 'row',
        alignItems: 'center',
        gap: nativeTokens.spacing[2],
        paddingHorizontal: nativeTokens.spacing[3],
        paddingVertical: nativeTokens.spacing[2],
        borderRadius: nativeTokens.radius.md,
    },
    keep: { alignItems: 'flex-start', gap: nativeTokens.spacing[1], paddingTop: nativeTokens.spacing[1] },
    meta: { ...nativeTokens.type.meta },
    hint: { paddingHorizontal: nativeTokens.spacing[3] },
});
