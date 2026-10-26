/**
 * @module @commise/features-recipes/form — how the Ingredients section lays the paste list beside its ordinary rows,
 * once for both platforms' leaves (ADR-0071). The draft lines the paste list owns are drawn by its matched list
 * (`PasteMatchedBlock`), so the ordinary rows leave them out: NO LINE IS DRAWN TWICE.
 *
 * Pure and platform-agnostic.
 */
import type { PasteMatchingView } from './props.js';

/** A section of rows, as far as this module reads it. */
interface RowsSection<Row extends { readonly line: { readonly key: string } }> {
    readonly rows: readonly Row[];
}

/**
 * The sections without the rows the paste list owns. A section left with no ordinary row stays (its heading and its add
 * field are still the section's), and draws no empty list. Pure.
 *
 * @param sections - The sections as the field group builds them.
 * @param ownedKeys - The draft line keys the paste list draws, or `undefined` where there is no paste list.
 * @returns The sections, or the same array when nothing is owned.
 */
export function withoutOwnedRows<
    Row extends { readonly line: { readonly key: string } },
    Section extends RowsSection<Row>,
>(sections: readonly Section[], ownedKeys: ReadonlySet<string> | undefined): readonly Section[] {
    if (ownedKeys === undefined || ownedKeys.size === 0) {
        return sections;
    }

    return sections.map((section) => ({
        ...section,
        rows: section.rows.filter((row) => !ownedKeys.has(row.line.key)),
    }));
}

/**
 * Whether the section has a paste block to draw: a line the paste list owns, its summary, or a notice (the daily limit
 * outlives the lines it landed as written). Pure.
 *
 * @param matching - The paste's matched lines, or `undefined`.
 * @returns `true` when the block has something to say.
 */
export function hasMatchedLines(matching: PasteMatchingView | undefined): matching is PasteMatchingView {
    return (
        matching !== undefined &&
        (matching.ownedKeys.size > 0 || matching.summary !== undefined || matching.notice !== undefined)
    );
}
