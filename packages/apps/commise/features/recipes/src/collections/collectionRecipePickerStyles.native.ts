/**
 * @module @commise/features-recipes/collections — the ONE `StyleSheet` behind the native recipe-picker frame and its
 * bodies (`CollectionRecipePicker`, `CollectionRecipePickerLoading`, `CollectionRecipePickerLoadError`,
 * `CollectionRecipePickerCandidates`). The frame and bodies share a state card, a text button and its label, so it
 * stays one cohesive object rather than a shard per file that could drift apart.
 *
 * The web counterpart is `collectionRecipePickerStyles.ts` (Tailwind class strings).
 */
import { palette, tint } from '@commise/ui';
import { StyleSheet } from 'react-native';

const border = 'rgba(178, 190, 195, 0.3)';

export const styles = StyleSheet.create({
    container: { flex: 1, gap: 12, paddingHorizontal: 16, paddingTop: 8 },
    headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    heading: { fontSize: 24, fontWeight: '700', color: palette.charcoal, flexShrink: 1 },
    textButton: { paddingVertical: 6, paddingHorizontal: 10 },
    // `ocean-dark`, not `seafoam`: this style paints BOTH bare text controls (Done, Try again), and seafoam as
    // a text foreground is 4.02:1 on white — under the 4.5:1 body-text floor. The seafoam FILLS below stay.
    linkLabel: { color: palette['ocean-dark'], fontWeight: '600', fontSize: 14 },
    input: {
        borderRadius: 10,
        borderWidth: 1,
        borderColor: border,
        paddingVertical: 10,
        paddingHorizontal: 12,
        fontSize: 16,
        color: palette.charcoal,
    },
    // 10%-alpha tint of `palette.error` (#C05238 → rgb(192, 82, 56)) — mirrors the web leaf's `bg-error/10`;
    // RN has no alpha-suffix colour syntax, so it is spelled out here. It previously spelled out
    // `rgba(232, 145, 122, 0.1)`, which is `palette.coral` (#E8917A) — a brand ACCENT filling an alert whose
    // own text is `palette['error-dark']`. Because the literal is opaque to a `palette.coral` grep, the test asserts
    // it against a tint DERIVED from the token (`tintOf(palette.error, 0.1)`) rather than a second literal.
    alert: { backgroundColor: tint(palette.error, 0.1), borderRadius: 10, padding: 12 },
    alertLabel: { color: palette['error-dark'], fontSize: 14 },
    announcement: { color: palette.slate, fontSize: 14 },
    stateCard: {
        backgroundColor: palette.white,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: border,
        padding: 16,
        gap: 6,
    },
    stateTitle: { fontSize: 15, fontWeight: '600', color: palette.charcoal },
    stateBody: { fontSize: 14, color: palette.slate },
    rows: { gap: 12, paddingBottom: 16 },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        backgroundColor: palette.white,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: border,
        padding: 14,
    },
    rowTitle: { fontSize: 16, fontWeight: '600', color: palette.charcoal, flexShrink: 1 },
    addControl: { backgroundColor: palette.seafoam, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 16 },
    addLabel: { color: palette.white, fontWeight: '600', fontSize: 14 },
    inertControl: { borderRadius: 999, paddingVertical: 8, paddingHorizontal: 16 },
    inertLabel: { color: palette.slate, fontWeight: '500', fontSize: 14 },
    primaryButton: {
        backgroundColor: palette.seafoam,
        borderRadius: 999,
        paddingVertical: 10,
        paddingHorizontal: 18,
        alignSelf: 'flex-start',
        marginTop: 4,
    },
    primaryLabel: { color: palette.white, fontWeight: '600', fontSize: 14 },
});
