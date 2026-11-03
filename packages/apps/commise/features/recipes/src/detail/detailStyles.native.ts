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
    // The page's scroll content. It ends 48 below the last block, the page end the web uses too
    // (`nativeBoards/designAnswers.md`). Nothing floats over it: the tab bar sits below the scroller and owns the
    // bottom safe area.
    container: { gap: nativeTokens.spacing[6], paddingBottom: nativeTokens.spacing[7] },
    top: { gap: nativeTokens.spacing[3], paddingHorizontal: nativeTokens.spacing[4] },
    actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: nativeTokens.spacing[2] },
    // One section (or the run of closing blocks) as a direct child of the scroll content: the page's one 16 gutter,
    // and the 8 that makes the 24 content gap between top blocks the 32 between sections.
    sectionBlock: { paddingHorizontal: nativeTokens.spacing[4], marginTop: nativeTokens.spacing[2] },
    twoColumns: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        // The section gap, 32 between the columns as between the sections (designer ruling, designAnswers.md).
        gap: nativeTokens.spacing[6],
        paddingHorizontal: nativeTokens.spacing[4],
    },
    scaleNotice: {
        alignItems: 'flex-start',
        gap: nativeTokens.spacing[1],
        borderRadius: nativeTokens.radius.lg,
        paddingHorizontal: nativeTokens.spacing[3],
        paddingVertical: nativeTokens.spacing[2],
    },
});
