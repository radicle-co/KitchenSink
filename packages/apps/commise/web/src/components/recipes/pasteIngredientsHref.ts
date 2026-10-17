/**
 * The Paste ingredients deep link (build spec §7.5.4; blueprint Part C slice 8): a new recipe's editor, scrolled to its
 * Ingredients section, with the Paste a list sheet open. Home's and My recipes' first-run Paste ingredients link to it,
 * and `RecipeEditorContainer` reads it back, so the address and its reading live once.
 *
 * The section is the URL's hash, as every editor deep link's is (blueprint A16, `sectionFromHash`).
 */
import type { EditorSectionId } from '@commise/features-recipes';

/** The query flag that asks the editor to open the sheet. */
const PASTE_PARAM = 'paste';

/** The section the link scrolls to. */
const PASTE_SECTION: EditorSectionId = 'ingredients';

/**
 * The deep link.
 *
 * @param locale - The route locale.
 * @returns The path. Pure.
 */
export function pasteIngredientsHref(locale: string): string {
    return `/${locale}/recipes/new?${PASTE_PARAM}=1#${PASTE_SECTION}`;
}

/**
 * Whether an editor's search parameters ask for the paste sheet.
 *
 * @param params - The page's search parameters.
 * @returns `true` for the deep link's flag. Pure.
 */
export function opensPasteSheet(params: Pick<URLSearchParams, 'get'>): boolean {
    return params.get(PASTE_PARAM) === '1';
}
