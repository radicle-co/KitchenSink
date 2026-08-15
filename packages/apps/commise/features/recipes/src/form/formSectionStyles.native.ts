/**
 * @module @commise/features-recipes/form — the ONE `StyleSheet` behind the native recipe-form field groups
 * (`RecipeBasicsFields`, `RecipeIngredientsFields`, `RecipeInstructionsFields`, `RecipeVisibilityField` and
 * their shared `Field` wrapper). A StyleSheet is a cohesive unit — the sections share a card, an input and a
 * row geometry, and a per-section shard would let those drift apart, which is the exact bug the `listRow`
 * comment below records — so it stays one exported object rather than being split four ways.
 *
 * The web counterpart is `formSectionStyles.ts` (Tailwind class strings).
 */
import { palette } from '@commise/ui';
import { StyleSheet } from 'react-native';

const border = 'rgba(178, 190, 195, 0.3)';

export const styles = StyleSheet.create({
    card: {
        backgroundColor: palette.white,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: border,
        padding: 16,
        gap: 12,
    },
    sectionHeading: { fontSize: 20, fontWeight: '600', color: palette.charcoal },
    field: { gap: 4 },
    fieldLabel: { fontSize: 13, fontWeight: '500', color: palette.slate },
    input: {
        backgroundColor: palette.white,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: border,
        paddingVertical: 10,
        paddingHorizontal: 12,
        fontSize: 16,
        color: palette.charcoal,
    },
    multiline: { minHeight: 88, textAlignVertical: 'top' },
    inputReadOnly: { backgroundColor: palette.pearl },
    timesRow: { flexDirection: 'row', gap: 12 },
    timeCol: { flex: 1 },
    difficultyRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    difficultyChip: {
        borderRadius: 999,
        borderWidth: 1,
        borderColor: border,
        backgroundColor: palette.white,
        paddingVertical: 6,
        paddingHorizontal: 16,
    },
    difficultyChipSelected: { borderColor: palette.seafoam, backgroundColor: palette.seafoam },
    difficultyChipLabel: { fontSize: 14, color: palette.charcoal },
    difficultyChipLabelSelected: { color: palette.white },
    // ONE geometry contract for BOTH dynamic list rows (ingredient lines, instruction steps) — they are one
    // piece of knowledge that changes for one reason: a row of flexible fields ending in a destructive remove
    // action, on a ~296dp-wide phone card. It used to be spelled twice, and the instruction row's copy was
    // missing `flexWrap` — which IS the bug. `flexWrap` is the load-bearing half: the children (a 28dp marker
    // + a 60%-basis field + an 88dp field + a ~160dp "Remove step N" pill) cannot share one line, and RN
    // defaults `flexShrink` to 0, so without it the action was laid out PAST the screen edge (the Maestro dump
    // caught "Remove step 1" at x=999..1080 on a 1080px display, half of it unreachable — the same failure
    // that clipped `CollectionHeader.native.tsx`'s Rename and dropped its Delete out of the hierarchy).
    // Shrinking alone would NOT do: on one line the instruction field would be squeezed to a few dp.
    listRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
    // The flexible field yields width (the web leaf's `min-w-0 flex-1`); the action never does, so its label
    // and its 44pt touch target can never be clipped (the web leaf's `shrink-0` idiom).
    rowGrow: { flexGrow: 1, flexShrink: 1, flexBasis: '60%' },
    rowNarrow: { width: 88 },
    rowAction: { flexShrink: 0 },
    stepMarker: {
        width: 28,
        height: 28,
        borderRadius: 999,
        backgroundColor: palette.seafoam,
        color: palette.white,
        textAlign: 'center',
        lineHeight: 28,
        fontWeight: '600',
        overflow: 'hidden',
    },
    statusBadge: { fontSize: 11, color: palette.slate },
    // Contrast (WCAG 2.1 AA): a badge a reader READS takes `ocean-dark` (6.20:1 on the white card) rather than
    // seafoam (4.02:1). Mirrors the web leaf's `text-ocean-dark`. The visibility Switch's `trackColor` (set in
    // `RecipeVisibilityField.native.tsx`) stays seafoam — a control track is a 3:1 graphic, not text.
    caloriesBadge: { fontSize: 12, fontWeight: '600', color: palette['ocean-dark'] },
    error: { color: palette['error-dark'], fontSize: 13 },
    emptyText: { color: palette.slate, fontSize: 13 },
    charCounter: { color: palette.slate, fontSize: 12 },
    totalTime: { color: palette.slate, fontSize: 13 },
    nutritionTotal: {
        gap: 4,
        borderRadius: 12,
        backgroundColor: palette.pearl,
        paddingHorizontal: 16,
        paddingVertical: 12,
    },
    nutritionTotalText: { fontSize: 13, fontWeight: '600', color: palette.charcoal },
    switchRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        backgroundColor: palette.white,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: border,
        padding: 16,
    },
    switchLabel: { fontSize: 16, color: palette.charcoal },
    addAction: { alignSelf: 'flex-start' },
});
