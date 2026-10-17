/**
 * @module @commise/features-recipes/editor — the editor's page gutter, as the Tailwind utilities the web frame and its
 * load and error states share.
 *
 * `<main>` gives a focused task no gutter (the frame runs edge to edge, F15), so the editor owns it. The numbers are the
 * layout tokens' (`@commise/ui/container-class`, `buildSpec.md` §1.2): 16 px compact, 24 px from 600, 32 px from 840.
 * `RecipeEditorView.test.tsx` pins this string to `gutterOf`, so a changed token cannot leave the editor behind.
 */

/** The editor's gutter on each side: `px-4` below 600, `medium:px-6` from 600, `nav:px-8` from 840. */
export const EDITOR_GUTTER = 'px-4 medium:px-6 nav:px-8';
