/**
 * @module @commise/features-recipes — the native recipe page's layout styles, shared by the body and the section
 * leaves it is composed of. Layout only: colours are read from the theme at render, so the page repaints in dark mode.
 */
import { nativeTokens } from '@commise/ui/native';
import { StyleSheet } from 'react-native';

/** The recipe page's native layout styles. */
export const detailStyles = StyleSheet.create({
    // Transparent so the root `AppCanvas` beach-glow gradient shows through (issue #145). An opaque fill here occludes
    // the whole canvas and restores the flat page the wireframes never had.
    scroll: { flex: 1, backgroundColor: 'transparent' },
    // The page's scroll content. The bottom padding clears the device's navigation bar, so the foot-of-screen controls
    // — the delete dialog's confirm button when it opens — can be scrolled fully into view.
    container: { gap: nativeTokens.spacing[6], paddingBottom: 120 },
    top: { gap: nativeTokens.spacing[3], paddingHorizontal: nativeTokens.spacing[4] },
    overline: { ...nativeTokens.type.overline },
    groupHeading: { paddingTop: nativeTokens.spacing[2] },
    title: { ...nativeTokens.type.largeTitle.narrow },
    ratingLine: { flexDirection: 'row', alignItems: 'center', gap: nativeTokens.spacing[2] },
    inline: { flexDirection: 'row', alignItems: 'center', gap: nativeTokens.spacing[1] },
    meta: { ...nativeTokens.type.meta },
    caption: { ...nativeTokens.type.caption },
    readingBody: { ...nativeTokens.type.readingBody },
    figures: { fontVariant: ['tabular-nums', 'lining-nums'] },
    figureGrid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: nativeTokens.spacing[4] },
    statStrip: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        borderRadius: nativeTokens.radius.lg,
        borderWidth: StyleSheet.hairlineWidth,
        paddingVertical: nativeTokens.spacing[2],
        ...nativeTokens.elevation.sm,
    },
    statCell: {
        gap: nativeTokens.spacing[1],
        paddingHorizontal: nativeTokens.spacing[3],
        paddingVertical: nativeTokens.spacing[2],
    },
    statValue: { ...nativeTokens.type.figureStat },
    actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: nativeTokens.spacing[2] },
    description: { alignItems: 'flex-start', gap: nativeTokens.spacing[1] },
    // One section (or the run of closing blocks) as a direct child of the scroll content: the page's one 16 gutter,
    // and the 8 that makes the 24 content gap between top blocks the 32 between sections.
    sectionBlock: { paddingHorizontal: nativeTokens.spacing[4], marginTop: nativeTokens.spacing[2] },
    // Blocks stacked with a section's gap and NO gutter of their own: the gutter belongs to whatever holds them.
    stack: { gap: nativeTokens.spacing[8] },
    hint: { alignSelf: 'flex-start' },
    twoColumns: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: nativeTokens.spacing[8],
        paddingHorizontal: nativeTokens.spacing[4],
    },
    ingredientsColumn: { flex: 5 },
    stepsColumn: { flex: 7 },
    section: { gap: nativeTokens.spacing[3] },
    headingRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: nativeTokens.spacing[2],
    },
    sectionHeading: { ...nativeTokens.type.sectionTitle },
    scaleNotice: {
        alignItems: 'flex-start',
        gap: nativeTokens.spacing[1],
        borderRadius: nativeTokens.radius.md,
        paddingHorizontal: nativeTokens.spacing[3],
        paddingVertical: nativeTokens.spacing[2],
    },
    caveat: { fontWeight: '600' },
    grow: { flexGrow: 1 },
    notice: {
        ...nativeTokens.type.meta,
        borderRadius: nativeTokens.radius.md,
        paddingHorizontal: nativeTokens.spacing[3],
        paddingVertical: nativeTokens.spacing[2],
    },
    steps: { gap: nativeTokens.spacing[6] },
    linkTouch: { minHeight: 48, justifyContent: 'center', alignSelf: 'flex-start' },
    link: { textDecorationLine: 'underline' },
    footer: { alignItems: 'flex-start', gap: nativeTokens.spacing[1] },
});
