/**
 * @module @commise/ui/input — the native design-system {@link TextArea}: a multi-line field on the shared field
 * geometry that grows with its content, from `minRows` to `maxRows` body lines.
 *
 * React Native reports the content's height through `onContentSizeChange`; the field holds the last report as local
 * view state and clamps it into the row bounds (past `maxRows` it scrolls). The height is the lines plus 16 pt of
 * padding above and below and the 1 pt edge.
 *
 * ⚠️ `onContentSizeChange` reports the TEXT's height on iOS and Android; react-native-web reports the node's
 * `scrollHeight`, which includes the vertical padding. Taking that as the text height and adding the padding back grew
 * the box by one padding per report, and each growth re-measured: an endless loop. {@link textContentHeight} takes the
 * padding off a web report, so the height is a fixed point (text + padding + edge) that a re-measure reproduces.
 *
 * While it has focus it asks the field reveal host to hold it in view (`useFocusReveal`), and when the screen names it
 * (`ScrollHost.scrollToField`) the host centres it and the screen-reader cursor moves to it, with the keyboard left down
 * (`useFieldTargetReveal`, `docs/design/uiOverhaul/specSharedSystem.md` §16.3).
 *
 * @pattern Template — one field geometry (`fieldStyle.ts`), rendered by both native text-field leaves
 * @pattern Adapter over `TextInput.focus()` — a level-triggered focus request, acknowledged once taken. It is the one
 *     reason this leaf holds a ref: focusing a field has no declarative form. The same node is what the reveal host
 *     measures and what the screen-reader cursor moves to.
 */
import { useRef, useState, type FC } from 'react';
import { Platform, StyleSheet, type TextInput as NativeTextInput } from 'react-native';

import { useFieldTargetReveal } from '../fieldReveal/useFieldTargetReveal.native.js';
import { useFocusReveal } from '../fieldReveal/useFocusReveal.native.js';
import { useFocusRequest } from '../focusRequest/useFocusRequest.js';
import { useTheme } from '../theme/useTheme.native.js';
import { nativeTokens } from '../tokens/native.js';
import { TextInput } from '../textInput/TextInput.native.js';
import { FIELD_EDGE, FIELD_PADDING, fieldDisabled, fieldGeometry, fieldPaint } from './fieldStyle.js';
import { fieldAccessibilityHint, fieldLabelId, type TextAreaProps } from './props.js';

/** One body line, in points. */
const LINE = nativeTokens.type.body.lineHeight ?? 24;

/**
 * The text's own height from a reported content height. Pure.
 *
 * @param reported - The height `onContentSizeChange` delivered.
 * @param platform - `Platform.OS`. react-native-web (`'web'`) reports the node's `scrollHeight`, which includes both
 *     vertical paddings; a device reports the text alone.
 * @returns The text height in points, padding excluded.
 */
export function textContentHeight(reported: number, platform: string): number {
    return platform === 'web' ? Math.max(0, reported - 2 * FIELD_PADDING) : reported;
}

/**
 * The field's height for a measured content height, clamped into its row bounds. Pure.
 *
 * @param content - The content height React Native last reported, or `null` before the first report.
 * @param minRows - The fewest lines it shows.
 * @param maxRows - The most lines it grows to, if bounded.
 * @returns The height in points, padding and edge included.
 */
export function textAreaHeight(content: number | null, minRows: number, maxRows: number | undefined): number {
    const floor = minRows * LINE;
    const ceiling = maxRows === undefined ? Number.POSITIVE_INFINITY : maxRows * LINE;

    return Math.min(Math.max(content ?? floor, floor), ceiling) + 2 * FIELD_PADDING + 2 * FIELD_EDGE;
}

/** The native design-system multi-line text field. */
export const TextArea: FC<TextAreaProps> = ({
    id,
    value,
    onChangeText,
    invalid = false,
    error,
    hint,
    label,
    placeholder,
    autoCapitalize,
    disabled = false,
    minRows,
    maxRows,
    focusRequested = false,
    onFocusRequestHandled,
}) => {
    const [content, setContent] = useState<number | null>(null);
    const theme = useTheme();
    const node = useRef<NativeTextInput>(null);
    useFocusRequest(focusRequested, () => node.current?.focus(), onFocusRequestHandled);
    // Whether the field has focus: the reveal host holds it in view while it does (§16.3).
    const [focused, setFocused] = useState(false);
    useFocusReveal(node, focused);
    useFieldTargetReveal(id, node);

    return (
        <TextInput
            ref={node}
            nativeID={id}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            multiline
            value={value}
            onChangeText={onChangeText}
            onContentSizeChange={(event) =>
                setContent(textContentHeight(event.nativeEvent.contentSize.height, Platform.OS))
            }
            aria-labelledby={fieldLabelId(id)}
            accessibilityLabel={label}
            accessibilityHint={fieldAccessibilityHint(error, hint)}
            placeholder={placeholder}
            placeholderTextColor={theme.colors.inkMuted}
            autoCapitalize={autoCapitalize}
            editable={!disabled}
            style={[
                styles.field,
                { height: textAreaHeight(content, minRows, maxRows) },
                fieldPaint(theme, invalid || error !== undefined),
                disabled ? styles.disabled : null,
            ]}
        />
    );
};

const styles = StyleSheet.create({
    field: { ...fieldGeometry, paddingVertical: FIELD_PADDING, textAlignVertical: 'top' },
    disabled: fieldDisabled,
});
