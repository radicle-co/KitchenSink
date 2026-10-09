/**
 * @module @commise/ui/input — the native text-field geometry, shared by `Input.native.tsx` and `TextArea.native.tsx`
 * (spec §1.6/§1.11: a 12 pt rectangle, a 1 pt `lineControl` edge, at least 48 tall, 16 of padding, the `body` role).
 *
 * A plain module rather than a `.native` leaf because it holds numbers and a pure paint function, not a component: the web leaves
 * spell the same geometry as utilities in `fieldClass.ts`, and the two change for different reasons.
 */
import type { TextStyle } from 'react-native';

import type { Theme } from '../theme/themeFor.js';
import { nativeTokens } from '../tokens/native.js';

/** The field's edge width, in points. */
export const FIELD_EDGE = 1;

/** The field's horizontal padding, and a multi-line field's vertical padding, in points. */
export const FIELD_PADDING = nativeTokens.spacing[4];

/** The field's minimum height, in points. */
export const FIELD_MIN_HEIGHT = 48;

/** The resting field. */
/**
 * The field's static geometry: the body face, the 48 pt minimum, the edge width, the radius and the padding. ⛔ No
 * colour: a colour here would be baked into one theme at import (D15). Paint it at render with {@link fieldPaint}.
 */
export const fieldGeometry = {
    ...nativeTokens.type.body,
    minHeight: FIELD_MIN_HEIGHT,
    borderWidth: FIELD_EDGE,
    borderRadius: nativeTokens.radius.md,
    paddingHorizontal: FIELD_PADDING,
    // A one-line field: the 24 pt body line plus 12 above and below is the 48 pt minimum.
    paddingVertical: nativeTokens.spacing[3],
} as const;

/**
 * The field's paint in a theme: `ink` on `paper` inside a `lineControl` edge, the `danger` edge when invalid. Pure.
 *
 * @param theme - The current theme (`useTheme()`).
 * @param invalid - Whether the field holds a value its form rejects.
 * @returns The colour half of the field's style.
 */
export function fieldPaint({ colors }: Theme, invalid: boolean): TextStyle {
    return {
        color: colors.ink,
        backgroundColor: colors.paper,
        borderColor: invalid ? colors.danger : colors.lineControl,
    };
}

export const fieldDisabled = { opacity: 0.4 } as const;
