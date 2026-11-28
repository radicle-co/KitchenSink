/**
 * Finds the dead class selectors of one screen board: a class that a `<style>` rule selects and that no element of the
 * board carries. The board is read by {@link readBoard} and each `<style>` with css-tree, so `@media`, `:is()`, `:not()`,
 * attribute selectors and `content:` strings are read as the browser reads them.
 */
import { parse as parseCss, walk } from 'css-tree';

import { classNameOf, readBoard } from './boardReading.js';

/**
 * The classes a board's `<style>` rules select that nothing in the board uses, sorted and unique. Pure.
 *
 * @param html - The board's source.
 */
export function deadClassSelectors(html: string): readonly string[] {
    const { styles, used } = readBoard(html);
    const selected = new Set<string>();

    styles.forEach(({ text }) => {
        walk(parseCss(text), {
            visit: 'Rule',
            enter(rule) {
                walk(rule.prelude, {
                    visit: 'ClassSelector',
                    enter(selector) {
                        selected.add(classNameOf(selector));
                    },
                });
            },
        });
    });

    return [...selected].filter((name) => !used.has(name)).sort((a, b) => a.localeCompare(b));
}
