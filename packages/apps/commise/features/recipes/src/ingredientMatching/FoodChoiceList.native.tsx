/**
 * @module @commise/features-recipes/ingredientMatching — `FoodChoiceList` (native): the React Native leaf of
 * `./FoodChoiceList.tsx`, on the same props and the same words (`matchLineView.ts`). Search for a food first, at its own
 * width (U5); then ONE bordered box on the raised paper (U2) holding the options in the server's order, the default
 * tagged (`OptionLabel`), and "Keep “line” as written · no nutrition" as its last row in the quiet ink (U6), hairlines
 * between the rows.
 *
 * Each option is a `ChoiceRow`, a `button` (staff-ux ruling 2026-10-25): VoiceOver and TalkBack read a radio as "not
 * selected", which implies a confirm step that does not exist. The bound food draws a check and its name ends
 * ", chosen"; no `selected` state as well, which would say it twice. While a send is in flight the control that started
 * it spins and reads busy, and every other control is disabled and dimmed (a disabled `Pressable` keeps screen-reader
 * focus on device). The box is a `list` named for its line, its rows `listitem`s, so the name is announced with the
 * count and marks where this line's list starts (U12; `docs/design/nativeContainerNames.md` N1 rules 4 and 5); the list
 * keeps its native node for that role. A focus request moves the screen-reader cursor to the view's `focusTarget`.
 * Rows keep the native touch floor and every name wraps, so nothing is cut off or scrolls sideways at 320 pt. Painted
 * from the theme's roles (D15).
 */
import { Button } from '@commise/ui/button';
import { ChoiceRow } from '@commise/ui/choice-row';
import { nativeTokens } from '@commise/ui/native';
import { OptionLabel } from '@commise/ui/option-label';
import { useTheme } from '@commise/ui/theme';
import type { FC } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { FoodChoiceListProps } from './foodChoiceListProps.js';
import { isFocusTarget, type ListFocusTarget } from './matchLineView.js';

/** A line's food-choice list: search, then the options and Keep as written in one box. */
export const FoodChoiceList: FC<FoodChoiceListProps> = ({ view, onSearch, onPick, focus }) => {
    const { colors } = useTheme();
    const { search, keep } = view;
    const requested = (control: ListFocusTarget): boolean =>
        focus.requested && isFocusTarget(view.focusTarget, control);
    const divided = { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.lineDivider };

    return (
        <View style={styles.list}>
            {search.kind === 'available' ? (
                <View style={styles.search}>
                    <Button
                        variant="ghost"
                        icon="search"
                        accessibilityLabel={search.name}
                        busy={search.busy}
                        refused={view.refusing && !search.busy}
                        focusRequested={requested({ kind: 'search' })}
                        onFocusRequestHandled={focus.onHandled}
                        onPress={onSearch}
                    >
                        {search.label}
                    </Button>
                </View>
            ) : (
                <Text style={[styles.words, { color: colors.inkMuted }]}>{search.text}</Text>
            )}
            <View
                collapsable={false}
                role="list"
                aria-label={view.optionsName}
                style={[styles.box, { borderColor: colors.lineDivider, backgroundColor: colors.paperRaised }]}
            >
                {view.rows.map((row, index) => (
                    <View key={row.id} collapsable={false} role="listitem" style={index > 0 ? divided : null}>
                        <ChoiceRow
                            accessibilityLabel={row.name}
                            chosen={row.chosen}
                            busy={row.busy}
                            refused={view.refusing && !row.busy}
                            focusRequested={requested({ kind: 'row', id: row.id })}
                            onFocusRequestHandled={focus.onHandled}
                            onPress={() => {
                                onPick(row.pick);
                            }}
                        >
                            <OptionLabel
                                label={row.label}
                                textSize="list"
                                {...(row.tag === undefined ? {} : { tag: row.tag })}
                                {...(row.detailParts === undefined ? {} : { detailParts: row.detailParts })}
                            />
                        </ChoiceRow>
                    </View>
                ))}
                <View collapsable={false} role="listitem" style={view.rows.length > 0 ? divided : null}>
                    <ChoiceRow
                        accessibilityLabel={keep.name}
                        chosen={keep.chosen}
                        busy={keep.busy}
                        refused={view.refusing && !keep.busy}
                        focusRequested={requested({ kind: 'keep' })}
                        onFocusRequestHandled={focus.onHandled}
                        onPress={() => {
                            onPick(keep.pick);
                        }}
                    >
                        <Text style={[styles.words, { color: colors.inkMuted }]}>{keep.label}</Text>
                    </ChoiceRow>
                </View>
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    list: { gap: nativeTokens.spacing[2] },
    search: { flexDirection: 'row' },
    box: { borderWidth: 1, borderRadius: nativeTokens.radius.md, overflow: 'hidden' },
    words: { ...nativeTokens.type.list },
});
