/**
 * @module @commise/ui/input — the native design-system {@link TextArea}: a multi-line field on the shared field
 * geometry that grows with its content, from `minRows` to `maxRows` body lines.
 *
 * React Native reports the content's height through `onContentSizeChange`; the field holds the last report as local
 * view state and clamps it into the row bounds (past `maxRows` it scrolls). The height is the lines plus 16 pt of
 * padding above and below and the 1 pt edge.
 *
 * ⚠️ `onContentSizeChange` reports the TEXT's height on iOS and Android; react-native-web measures the node's
 * `scrollHeight`, which includes padding. The clamp keeps both inside the bounds, but the web shim can read a field one
 * padding taller than a device would — a device check, recorded in the slice report.
 *
 * @pattern Template — one field geometry (`fieldStyle.ts`), rendered by both native text-field leaves
 */
import { useState, type FC } from 'react';
import { StyleSheet } from 'react-native';

import { useTheme } from '../theme/useTheme.native.js';
import { nativeTokens } from '../tokens/native.js';
import { TextInput } from '../textInput/TextInput.native.js';
import { FIELD_EDGE, FIELD_PADDING, fieldDisabled, fieldGeometry, fieldPaint } from './fieldStyle.js';
import { fieldLabelId, type TextAreaProps } from './props.js';

/** One body line, in points. */
const LINE = nativeTokens.type.body.lineHeight ?? 24;

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
    describedBy,
    placeholder,
    autoCapitalize,
    disabled = false,
    minRows,
    maxRows,
}) => {
    const [content, setContent] = useState<number | null>(null);
    const theme = useTheme();

    return (
        <TextInput
            nativeID={id}
            multiline
            value={value}
            onChangeText={onChangeText}
            onContentSizeChange={(event) => setContent(event.nativeEvent.contentSize.height)}
            aria-labelledby={fieldLabelId(id)}
            aria-invalid={invalid}
            aria-describedby={describedBy}
            placeholder={placeholder}
            placeholderTextColor={theme.colors.inkMuted}
            autoCapitalize={autoCapitalize}
            editable={!disabled}
            style={[
                styles.field,
                { height: textAreaHeight(content, minRows, maxRows) },
                fieldPaint(theme, invalid),
                disabled ? styles.disabled : null,
            ]}
        />
    );
};

const styles = StyleSheet.create({
    field: { ...fieldGeometry, paddingVertical: FIELD_PADDING, textAlignVertical: 'top' },
    disabled: fieldDisabled,
});
