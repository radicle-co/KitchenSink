/**
 * @module @commise/features-recipes/form — how the Ingredients section lays the paste list beside its ordinary rows, for
 * both platforms' leaves (ADR-0071): whether the container is the wide one (the side pane stands beside the matched
 * list), the sections without the lines the paste list owns (NO LINE DRAWN TWICE), and the paste's matched block when
 * it has something to say.
 *
 * @pattern Headless hook — the section's paste layout, drawn by a web and a native leaf
 */
import { useMainContainerClass } from '../layout/useMainContainerClass.js';
import { hasMatchedLines, withoutOwnedRows } from './pasteSectionsView.js';
import type { IngredientsPasteView, PasteMatchingView } from './props.js';

/** What the leaf draws. */
export interface PasteLayout<Section> {
    /** The container is the wide class: the side pane stands beside the matched list. */
    readonly wide: boolean;
    /** The sections without the rows the paste list owns. */
    readonly sections: readonly Section[];
    /** The paste's matched lines, summary and notice; `undefined` when there is nothing to draw. */
    readonly matching: PasteMatchingView | undefined;
}

/**
 * The section's paste layout.
 *
 * @param sections - The sections as the field group builds them.
 * @param paste - The paste's view, if the host draws one.
 * @returns Whether the container is wide, the sections to draw, and the matched block's view.
 */
export function usePasteLayout<
    Row extends { readonly line: { readonly key: string } },
    Section extends { readonly rows: readonly Row[] },
>(sections: readonly Section[], paste: IngredientsPasteView | undefined): PasteLayout<Section> {
    const matching = paste?.matching;

    return {
        wide: useMainContainerClass() === 'wide',
        sections: withoutOwnedRows(sections, matching?.ownedKeys),
        matching: hasMatchedLines(matching) ? matching : undefined,
    };
}
