/**
 * The pruner over every tracked board, in memory (nothing is written). The checks are properties of any prune, so they
 * hold for the boards of today and of tomorrow: the prune is idempotent, it never touches the HTML, it never drops a
 * selector that names no dead class, and it leaves a dead class only in a selector it keeps on purpose.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse as parseCss, walk } from 'css-tree';
import { describe, expect, it } from 'vitest';

import { readBoard } from '../src/boardReading.js';
import { deadClassSelectors } from '../src/deadClassSelectors.js';
import { pruneDeadClassRules } from '../src/pruneDeadClassRules.js';

const root = resolve(fileURLToPath(import.meta.url), '../../../../..');
const files = execFileSync('git', ['ls-files', 'docs/design/canvases'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 1 << 26,
})
    .split('\n')
    .filter((file) => file.endsWith('.dc.html'));
const boards = files.map((file) => ({ file, before: readFileSync(resolve(root, file), 'utf8') }));
const pruned = boards.map(({ file, before }) => ({ file, before, after: pruneDeadClassRules(before) }));

/** Each rule's selector items paired with their rule block, as text, for every `<style>` of the board. */
function selectorsWithBlocks(html: string): { readonly text: string; readonly names: readonly string[] }[] {
    return readBoard(html).styles.flatMap(({ text }) => {
        const found: { text: string; names: string[] }[] = [];

        walk(parseCss(text, { positions: true }), {
            visit: 'Rule',
            enter(rule) {
                const block = text.slice(rule.block.loc?.start.offset, rule.block.loc?.end.offset);

                if (rule.prelude.type === 'SelectorList') {
                    rule.prelude.children.forEach((item) => {
                        if (item.type === 'Selector') {
                            const names: string[] = [];

                            walk(item, { visit: 'ClassSelector', enter: (name) => void names.push(name.name) });
                            found.push({
                                text: `${text.slice(item.loc?.start.offset, item.loc?.end.offset)}${block}`,
                                names,
                            });
                        }
                    });
                }
            },
        });

        return found;
    });
}

/** The board with every editable `<style>` text cut out, found by the offsets the reader reports. */
function outsideStyles(html: string): string {
    const cuts = readBoard(html).styles.flatMap(({ text, offset }) =>
        offset === undefined ? [] : [[offset, offset + text.length] as const],
    );
    const pieces = cuts.map(([start], index) => html.slice(cuts[index - 1]?.[1] ?? 0, start));

    return [...pieces, html.slice(cuts.at(-1)?.[1] ?? 0)].join('');
}

const usedOf = (html: string): string => [...readBoard(html).used].sort().join(' ');

/** The class selectors in the chain of each top-level selector item, not inside a `:not()` or a list. */
function ownClasses(html: string): string[] {
    return readBoard(html).styles.flatMap(({ text }) => {
        const own: string[] = [];

        walk(parseCss(text), {
            visit: 'Rule',
            enter(rule) {
                if (rule.prelude.type === 'SelectorList') {
                    rule.prelude.children.forEach((item) => {
                        if (item.type === 'Selector') {
                            item.children.forEach((child) => {
                                if (child.type === 'ClassSelector') {
                                    own.push(child.name);
                                }
                            });
                        }
                    });
                }
            },
        });

        return own;
    });
}

describe('pruning every board', () => {
    it('reads real boards, so a property cannot pass by reading nothing', () => {
        expect(boards.length).toBeGreaterThan(0);
    });

    it('is idempotent', () => {
        expect(pruned.filter(({ after }) => pruneDeadClassRules(after) !== after).map(({ file }) => file)).toEqual([]);
    });

    it('keeps the HTML outside the style text byte for byte, and the used classes', () => {
        const changed = pruned.filter(
            ({ before, after }) => outsideStyles(before) !== outsideStyles(after) || usedOf(before) !== usedOf(after),
        );

        expect(changed.map(({ file }) => file)).toEqual([]);
    });

    it('drops no selector that names no dead class, and keeps its rule block', () => {
        const lost = pruned.flatMap(({ file, before, after }) => {
            const dead = new Set(deadClassSelectors(before));
            const kept = new Set(selectorsWithBlocks(after).map(({ text }) => text));

            return selectorsWithBlocks(before)
                .filter(({ names, text }) => !names.some((name) => dead.has(name)) && !kept.has(text))
                .map(({ text }) => `${file}: ${text.slice(0, 60)}`);
        });

        expect(lost).toEqual([]);
    });

    it('leaves a dead class only in a selector it keeps on purpose, never in the selector chain itself', () => {
        const stuck = pruned.flatMap(({ file, after }) => {
            const dead = new Set(deadClassSelectors(after));

            return ownClasses(after)
                .filter((name) => dead.has(name))
                .map((name) => `${file}: .${name}`);
        });

        expect(stuck).toEqual([]);
    });
});
