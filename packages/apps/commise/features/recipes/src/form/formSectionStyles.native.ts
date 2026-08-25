/**
 * @module @commise/features-recipes/form — the ONE `StyleSheet` behind the native recipe-form field groups
 * (`RecipeBasicsFields`, `RecipeIngredientsFields`, `RecipeInstructionsFields`, `RecipeVisibilityField` and
 * their shared `Field` wrapper). A StyleSheet is a cohesive unit — the sections share a card, an input and a
 * row geometry, and a per-section shard would let those drift apart, which is the exact bug the `listRow`
 * comment below records — so it stays one exported object rather than being split four ways.
 *
 * The web counterpart is `formSectionStyles.ts` (Tailwind class strings).
 */
import { palette, tint } from '@commise/ui';
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
    // Shared by BOTH single-choice chip groups on this step — difficulty (FR-001b) and meal type (U34).
    // They are one piece of knowledge ("a pick-at-most-one pill on a phone card") that changes for one
    // reason, so the second group reuses this rather than growing a near-copy.
    //
    // ⚠️ `minHeight` is a FIX, not decoration. Padding alone gave a ~32dp pill — under the 44dp floor these
    // chips are the only way to state a difficulty or a meal type, so the miss rate falls on the one control
    // that sets the field. It surfaced when the meal-type group was added and its touch-target test failed
    // against the style it had inherited; the difficulty group had carried the same shortfall silently.
    difficultyChip: {
        borderRadius: 999,
        borderWidth: 1,
        borderColor: border,
        backgroundColor: palette.white,
        minHeight: 44,
        justifyContent: 'center',
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
    //
    // ⛔ `flexBasis: '100%'` IS LOAD-BEARING — at 60% the ingredient NAME rendered as "oil", "lic", "no",
    // "on". U9 gave each line a second bound, so this row is `[name][low][–][high][unit]`: three
    // `rowNarrow` boxes plus four gaps claim ~306dp of the ~311dp a 375dp phone leaves after the screen's
    // 16pt and the card's 16pt of horizontal padding. A shrinkable name with no floor simply yielded what
    // was left, which was ~34dp.
    //
    // Giving the name its OWN line is what fixes it, rather than a floor that merely stops the crush: at
    // 60% + a floor the row wraps as `[name][low][–]` / `[high][unit]`, splitting a range across two lines
    // with the dash orphaned. `listRow` already sets `flexWrap: 'wrap'`; this makes the wrap land in the
    // one place that reads correctly — the name above, the whole quantity group below it.
    rowGrow: { flexGrow: 1, flexShrink: 1, flexBasis: '100%' },
    // The quantity boxes may COMPRESS so the group is never itself split. React Native defaults
    // `flexShrink` to 0 (unlike the web), so `width` alone is rigid: at full width the group needs ~304dp
    // against the ~311 a 375dp phone leaves — seven points, which is inside the error bar on the separator
    // glyph and gone entirely on a 360dp device. The shrink makes the fit robust rather than lucky.
    rowNarrow: { width: 88, flexShrink: 1, minWidth: 64 },
    // The EN DASH between an ingredient's two quantity bounds (U9/R42) — decorative punctuation, so it
    // never yields width and never grows the row.
    rangeSeparator: { flexShrink: 0, color: palette.slate, fontSize: 13 },
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
    // U26/U27 — the two new row fields. `rowGrow`-width for the preparation (a phrase needs the line) and a
    // narrower box for the section, which is the quieter of the two by the brief's own ruling that per-row
    // typing is the SECONDARY way to group.
    rowPreparation: { flexGrow: 1, flexShrink: 1, flexBasis: '100%' },
    rowGroup: { flexGrow: 1, flexShrink: 1, flexBasis: '100%' },
    // U27 — a section heading. `h3`-equivalent: smaller than the section's own `sectionHeading`, because it
    // sits UNDER it. Rendered only for a LABELLED run, so an ungrouped recipe shows none at all.
    groupHeading: { fontSize: 15, fontWeight: '600', color: palette.charcoal },
    // U27 — one run of lines plus its heading.
    groupSection: { gap: 8 },
    // U25 — a non-canonical unit's own text style. ⛔ NOT `inputReadOnly`, which greys the FIELD and would
    // tell a cook the control is disabled when it is fully editable; this de-emphasises the VALUE, mirroring
    // the web leaf's `text-slate italic` and the mockup's intent. The meaning is carried by the note below,
    // never by this styling alone.
    inputSubdued: { color: palette.slate, fontStyle: 'italic' },
    // U25 — the derived unit note. A caption, in the same de-emphasised slate the empty state uses: it
    // DESCRIBES the unit, and is never an error.
    unitNote: { fontSize: 11, color: palette.slate },
    statusBadge: { fontSize: 11, color: palette.slate },
    // U14 — the doubted-line badge. Deliberately NOT a variant spread over `statusBadge`: the two are two
    // different facts, and a shared base would make a tone change to one silently change the other.
    //
    // ⛔ Charcoal (10.31:1) on a `warning` TINT, never `warning` as the foreground — `@commise/ui`'s palette
    // JSDoc is explicit that #F5B041 is a light fill that takes a charcoal label. Same pair as the web leaf's
    // `bg-warning/25 text-charcoal` and the detail body's badge.
    statusBadgeNeedsReview: {
        fontSize: 11,
        fontWeight: '600',
        color: palette.charcoal,
        backgroundColor: tint(palette.warning, 0.25),
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 999,
    },
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
