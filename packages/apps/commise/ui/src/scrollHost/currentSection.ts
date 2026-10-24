/**
 * @module @commise/ui/scroll-host — the scroll spy's one algorithm (`docs/architecture/uiOverhaulBlueprint.md` A7):
 * which section the reader is in. Both `ScrollHost` leaves feed it, web from `getBoundingClientRect` and native from
 * each section's `onLayout`, so the two platforms cannot disagree on the rule.
 */

/** One section's id and the y of its top edge, in the scroller's content coordinates. */
export interface SectionTop {
    readonly id: string;
    readonly top: number;
}

/**
 * The section the reader is in: the last one whose top has reached the activation line (`scrollY + activationY`). At
 * the end of the page the LAST section is current, because a short final section can never reach the line.
 *
 * @param tops - Each section's top, in any order.
 * @param scrollY - The scroller's offset.
 * @param activationY - How far below the scroller's top edge the line sits (under a sticky bar, say).
 * @param atEnd - Whether the scroller is at its end.
 * @returns The current section's id, or `undefined` before the first section reaches the line. Pure.
 */
export function currentSectionOf(
    tops: readonly SectionTop[],
    scrollY: number,
    activationY: number,
    atEnd: boolean,
): string | undefined {
    const ordered = [...tops].sort((a, b) => a.top - b.top);

    if (atEnd) {
        return ordered.at(-1)?.id;
    }

    const line = scrollY + activationY;

    return ordered.filter((section) => section.top <= line).at(-1)?.id;
}
