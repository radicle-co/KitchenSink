/**
 * @module @commise/ui/search-field — the native design-system {@link SearchField}: the one pill input.
 *
 * A 48 pt pill on `paper` with a 1 pt `lineControl` edge, a leading `search` glyph (`inkMuted`, hidden), and while
 * non-empty a clear control (44 pt, 48 dp on Android) named by the caller's `clearLabel`. The OS's own clear button is
 * off (`clearButtonMode="never"`) and the return key says "search". Its label is the `FieldLabel` above it, or, hidden,
 * the field's own accessible name.
 *
 * Clearing empties the field and returns the screen-reader cursor to it through `useScreenReaderFocusOnSignal` (the
 * registered Adapter — this leaf holds no ref of its own). The keyboard stays as the host's
 * `keyboardShouldPersistTaps` leaves it.
 *
 * `focusSignal` hands the field KEYBOARD focus when a counter the screen owns advances (`useFocusInputOnSignal`), for a
 * proxy elsewhere in the reading order.
 *
 * @pattern Adapter over `@commise/ui/text-input` — the label, glyph and clear control are the primitive's
 */
import { useState, type FC } from 'react';
import { Platform, Pressable, StyleSheet, View, type TextInput as NativeTextInput } from 'react-native';

import { Icon } from '../icon/Icon.native.js';
import { FieldLabel } from '../input/FieldLabel.native.js';
import { fieldLabelId } from '../input/props.js';
import { useScreenReaderFocusOnSignal } from '../screenReaderFocus/useScreenReaderFocusOnSignal.native.js';
import { TextInput } from '../textInput/TextInput.native.js';
import { scaledTypeSize } from '../text/scaledType.js';
import { TextScaleContext } from '../text/textScaleContext.native.js';
import { useTheme } from '../theme/useTheme.native.js';
import { useFocusInputOnSignal } from './useFocusInputOnSignal.native.js';
import { nativeTokens } from '../tokens/native.js';
import type { SearchFieldProps } from './props.js';
import { touchFloor } from '../layout/touchFloor.native.js';
import { Surface } from '../surfaceTone/Surface.native.js';

/** The pill's height, in points. */
const PILL_HEIGHT = 48;

/** The native design-system search field. */
export const SearchField: FC<SearchFieldProps> = ({
    id,
    label,
    labelVisibility,
    clearLabel,
    value,
    onChangeText,
    onSubmit,
    placeholder,
    onFocus,
    onBlur,
    focusSignal,
}) => {
    const { colors } = useTheme();
    // The input takes the body role's size at the capped scale, as the design-system Text does. Its leading is set on
    // Android only: React Native's iOS text input applies a line height without the baseline offset that centres a Text,
    // so the text sat at the bottom of a taller line box, low in the pill (`RCTTextLayoutManager.mm` applies the offset to
    // Text alone). The platform centres an unconstrained line.
    const body = scaledTypeSize('body', TextScaleContext.useStyledContext().textScale);
    const [clears, setClears] = useState(0);
    const field = useScreenReaderFocusOnSignal<NativeTextInput>(clears);
    useFocusInputOnSignal(field, focusSignal);

    return (
        <View style={styles.stack}>
            {labelVisibility === 'visible' ? <FieldLabel forId={id} label={label} /> : null}
            <Surface tone="paper" style={[styles.pill, { borderColor: colors.lineControl }]}>
                <Icon name="search" size={20} tone="inkMuted" />
                <TextInput
                    ref={field}
                    nativeID={id}
                    {...(labelVisibility === 'visible'
                        ? { 'aria-labelledby': fieldLabelId(id) }
                        : { 'aria-label': label })}
                    value={value}
                    onChangeText={onChangeText}
                    onSubmitEditing={onSubmit}
                    placeholder={placeholder}
                    onFocus={onFocus}
                    onBlur={onBlur}
                    placeholderTextColor={colors.inkMuted}
                    enterKeyHint="search"
                    clearButtonMode="never"
                    autoCorrect={false}
                    allowFontScaling={false}
                    style={[
                        styles.input,
                        {
                            color: colors.ink,
                            fontSize: body.fontSize,
                            ...(Platform.OS === 'ios' ? {} : { lineHeight: body.lineHeight }),
                        },
                    ]}
                />
                {value === '' ? null : (
                    <Pressable
                        role="button"
                        aria-label={clearLabel}
                        onPress={() => {
                            onChangeText('');
                            setClears((count) => count + 1);
                        }}
                        style={[styles.clear, { minWidth: touchFloor(), minHeight: touchFloor() }]}
                    >
                        <Icon name="x" size={20} />
                    </Pressable>
                )}
            </Surface>
        </View>
    );
};

const styles = StyleSheet.create({
    stack: { gap: nativeTokens.spacing[1] },
    pill: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: nativeTokens.spacing[2],
        minHeight: PILL_HEIGHT,
        borderRadius: PILL_HEIGHT / 2,
        borderWidth: 1,
        paddingStart: nativeTokens.spacing[4],
        paddingEnd: nativeTokens.spacing[1],
    },
    input: { fontFamily: nativeTokens.type.body.fontFamily, flex: 1, minHeight: PILL_HEIGHT - 2 },
    clear: { alignItems: 'center', justifyContent: 'center', borderRadius: nativeTokens.radius.full },
});
