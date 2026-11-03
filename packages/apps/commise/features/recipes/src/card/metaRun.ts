/**
 * @module @commise/features-recipes/card — the meta line as ONE run of text, built the same way on both platforms
 * (UI Designer ruling, 2026-11-03, `docs/design/uiRefreshWorkshop5/nativeBoards/designAnswers.md`).
 *
 * The line reads "45 min · Easy · No ratings yet · 370 cal". It is text, so it wraps like text with no clip and no
 * truncation, and a part that does not exist leaves no separator behind. The space before each "·" is a no-break space,
 * so a dot stays with the word before it and never starts a line. The separator is a design constant, not locale text:
 * the words around it are the ones that go through i18n.
 *
 * Pure.
 *
 * @pattern Builder — joins the parts that exist into one run; the web and native leaves only wrap it in their text primitive
 */
import { createContext, createElement, Fragment, isValidElement, type ReactNode } from 'react';

/** The separator between two parts: a no-break space, the dot, then an ordinary space. A design constant. */
export const META_SEPARATOR = ' · ';

/**
 * What a part that may settle on nothing (the calorie figure) draws before itself: the separator when parts precede it, and
 * nothing when it comes first. The part draws it only when it has something to say, so a figure that settles on nothing
 * leaves no dot behind, on either platform.
 */
export const MetaLeadContext = createContext('');

/** Whether a part has anything to draw. An empty string, `false`, `null` and `undefined` do not. */
function hasData(part: ReactNode): boolean {
    return part !== undefined && part !== null && part !== false && part !== '';
}

/**
 * The run of a meta line: the parts that exist, joined by the separator.
 *
 * @param parts - The line's parts in reading order; a part with no data is `undefined`, `null`, `false` or `''`.
 * @returns The run's children, empty when no part has data. Nested nodes are keyed and kept whole.
 */
export function metaRunOf(parts: readonly ReactNode[]): ReactNode[] {
    return parts.filter(hasData).flatMap((part, index) => {
        const node = isValidElement(part) ? createElement(Fragment, { key: index }, part) : part;

        return index === 0 ? [node] : [META_SEPARATOR, node];
    });
}
