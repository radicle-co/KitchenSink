/**
 * @module @commise/features-recipes/form — the layout `StyleSheet` the native recipe form's field groups share: the
 * authored-food sheet's fields and the nutrition panel's body. It holds LAYOUT ONLY (D15, `darkTheme.md` §7.3): a
 * colour here would be baked into one theme at import, so each consumer paints at render from `useTheme()` — a field
 * with the design system's `fieldPaint`, text with `ink` or `inkMuted`.
 *
 * The web counterpart is `formSectionStyles.ts` (Tailwind class strings).
 */
import { fieldGeometry } from '@commise/ui/input';
import { nativeTokens } from '@commise/ui/native';
import { StyleSheet } from 'react-native';

export const styles = StyleSheet.create({
    field: { gap: 4 },
    // The design-system field geometry (`@commise/ui/input`, spec §1.11; finding N1), so a recipe field and an `Input`
    // cannot drift apart.
    fieldLabel: { ...nativeTokens.type.label },
    input: { ...fieldGeometry },
    // Plan 002 V1 — a row's explanation in its status sheet: body copy.
    panelText: {
        fontSize: nativeTokens.fontSize.bodySm,
        lineHeight: nativeTokens.fontSize.bodySm * nativeTokens.lineHeight.body,
    },
    // Plan 002 V1 B5 — the nutrition panel's layout: a stack, and one row per labelled figure.
    panelStack: { gap: nativeTokens.spacing[2] },
    panelFigures: { gap: nativeTokens.spacing[1] },
    panelFigureRow: { flexDirection: 'row', flexWrap: 'wrap', columnGap: nativeTokens.spacing[4] },
    panelFigureLabel: {
        fontSize: nativeTokens.fontSize.caption,
        lineHeight: nativeTokens.fontSize.caption * nativeTokens.lineHeight.caption,
    },
    addAction: { alignSelf: 'flex-start' },
});
