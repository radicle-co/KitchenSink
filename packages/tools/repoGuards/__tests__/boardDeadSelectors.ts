/**
 * Finds the dead class selectors of one screen board: a class that a `<style>` rule selects and that no element of the
 * board carries. The board is read with parse5 and each `<style>` with css-tree, so `@media`, `:is()`, `:not()`,
 * attribute selectors and `content:` strings are read as the browser reads them.
 *
 * A class counts as used when it appears in any `class` attribute, or anywhere in a `<script>`: every board carries a
 * script, and a class that script sets at run time is not dead. Missing a dead rule is the safe mistake; failing a
 * live one is not.
 */
import { parse as parseCss, walk } from 'css-tree';
import { defaultTreeAdapter, parse, type DefaultTreeAdapterMap } from 'parse5';

type Node = DefaultTreeAdapterMap['node'];

interface Reading {
    readonly css: string[];
    readonly used: Set<string>;
}

const TOKEN = /[\w-]+/gu;

/**
 * Walks the board once: the text of each `<style>`, and every token a `class` attribute or a `<script>` holds. Pure.
 */
function read(node: Node, into: Reading): Reading {
    if (defaultTreeAdapter.isElementNode(node)) {
        const text = node.childNodes.map((child) => (defaultTreeAdapter.isTextNode(child) ? child.value : '')).join('');

        if (node.tagName === 'style') {
            into.css.push(text);

            return into;
        }

        if (node.tagName === 'script') {
            (text.match(TOKEN) ?? []).forEach((token) => into.used.add(token));
        }

        node.attrs
            .filter((attr) => attr.name === 'class')
            .flatMap((attr) => attr.value.split(/\s+/u))
            .forEach((token) => into.used.add(token));
    }

    const children = 'content' in node ? [node.content] : 'childNodes' in node ? node.childNodes : [];
    children.forEach((child) => read(child, into));

    return into;
}

/**
 * The classes a board's `<style>` rules select that nothing in the board uses, sorted and unique. Pure.
 *
 * @param html - The board's source.
 */
export function deadClassSelectors(html: string): readonly string[] {
    const { css, used } = read(parse(html), { css: [], used: new Set() });
    const selected = new Set<string>();

    css.forEach((sheet) => {
        walk(parseCss(sheet), {
            visit: 'Rule',
            enter(rule) {
                walk(rule.prelude, {
                    visit: 'ClassSelector',
                    enter(selector) {
                        selected.add(selector.name);
                    },
                });
            },
        });
    });

    return [...selected].filter((name) => !used.has(name)).sort();
}
