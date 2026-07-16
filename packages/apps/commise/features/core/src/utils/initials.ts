/**
 * @module @commise/features-core — viewer initials for the Home avatar (Home chrome).
 *
 * Shared, pure, and platform-agnostic: the web top bar and the native top bar must derive the SAME initials
 * from the SAME profile, so this is not forked per app.
 */

/**
 * Derive the avatar initials for a display name — first letter of the first word plus first letter of the
 * last word (the mockup's "JD").
 *
 * Iterates by **code point** (`[...word]`), not by code unit: `name[0]` on a name outside the BMP (an
 * astral-plane letter, an emoji) slices a surrogate pair in half and renders a replacement glyph. Names are
 * user data from Clerk and are not guaranteed ASCII.
 *
 * An absent, empty, or whitespace-only name yields `''` — the caller decides what to draw instead (a
 * name-less viewer is a real state: Clerk accounts created by email have no name until the user sets one).
 *
 * @param displayName - The viewer's display name, if known.
 * @returns One or two upper-cased initials, or `''` when no letter can be derived. Pure.
 */
export function initialsFor(displayName: string | undefined): string {
    const words = (displayName ?? '')
        .trim()
        .split(/\s+/u)
        .filter((word) => word.length > 0);

    const first = words[0];

    if (first === undefined) {
        return '';
    }

    const last = words.length > 1 ? words[words.length - 1] : undefined;
    const firstInitial = [...first][0] ?? '';
    const lastInitial = last === undefined ? '' : ([...last][0] ?? '');

    return `${firstInitial}${lastInitial}`.toUpperCase();
}
