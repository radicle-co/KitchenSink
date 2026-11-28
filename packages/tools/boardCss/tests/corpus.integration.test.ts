/**
 * The pruner over every tracked board, in memory (nothing is written). The checks are properties of any prune, so they
 * hold for the boards of today and of tomorrow: the prune is idempotent, it never touches the HTML, it never drops a
 * selector that names no dead class, and it leaves a dead class only in a selector it keeps on purpose.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse as parseCss, walk, type CssNode, type Selector } from 'css-tree';
import { describe, expect, it } from 'vitest';

import { classNameOf, readBoard } from '../src/boardReading.js';
import { deadClassSelectors } from '../src/deadClassSelectors.js';
import { pruneBoard, pruneDeadClassRules } from '../src/pruneDeadClassRules.js';

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

                            walk(item, { visit: 'ClassSelector', enter: (name) => void names.push(classNameOf(name)) });
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

/**
 * Whether a selector can only match through a dead class: a dead class in its own chain, or a `:is()`/`:where()`/`:has()`
 * whose every item does. Written out here as the keep rules of the design, apart from the code under test, so a pruner that
 * stops reading one of those lists turns this red. `:not()` is never entered.
 */
function needsDead(selector: CssNode, dead: ReadonlySet<string>): boolean {
    return (
        selector.type === 'Selector' &&
        selector.children.some((part) => {
            if (part.type === 'ClassSelector') {
                return dead.has(classNameOf(part));
            }

            const list = part.type === 'PseudoClassSelector' ? part.children?.first : null;

            return (
                ['is', 'where', 'has'].includes(part.type === 'PseudoClassSelector' ? part.name : '') &&
                list?.type === 'SelectorList' &&
                list.children.size > 0 &&
                list.children.toArray().every((item) => needsDead(item, dead))
            );
        })
    );
}

/** The top-level selector items of every rule of the board. */
function topLevelSelectors(html: string): Selector[] {
    return readBoard(html).styles.flatMap(({ text }) => {
        const found: Selector[] = [];

        walk(parseCss(text), {
            visit: 'Rule',
            enter(rule) {
                if (rule.prelude.type === 'SelectorList') {
                    rule.prelude.children.forEach((item) => {
                        if (item.type === 'Selector') {
                            found.push(item);
                        }
                    });
                }
            },
        });

        return found;
    });
}

const counted = (texts: readonly string[]): Map<string, number> =>
    texts.reduce((counts, text) => counts.set(text, (counts.get(text) ?? 0) + 1), new Map<string, number>());

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

    it('removes selectors from the boards, so a prune that does nothing cannot pass', () => {
        const removed = boards.reduce((sum, { before }) => sum + pruneBoard(before).removed, 0);

        expect(pruned.some(({ before, after }) => before !== after)).toBe(true);
        expect(removed).toBeGreaterThan(0);
    });

    it('drops no selector that names no dead class, and keeps its rule block, as often as it was there', () => {
        const lost = pruned.flatMap(({ file, before, after }) => {
            const dead = new Set(deadClassSelectors(before));
            const kept = counted(selectorsWithBlocks(after).map(({ text }) => text));
            const live = selectorsWithBlocks(before).filter(({ names }) => !names.some((name) => dead.has(name)));

            return [...counted(live.map(({ text }) => text))]
                .filter(([text, count]) => (kept.get(text) ?? 0) < count)
                .map(([text]) => `${file}: ${text.slice(0, 60)}`);
        });

        expect(lost).toEqual([]);
    });

    it('leaves no selector that needs a dead class, only the ones it keeps on purpose', () => {
        const stuck = pruned.flatMap(({ file, after }) => {
            const dead = new Set(deadClassSelectors(after));

            return topLevelSelectors(after)
                .filter((selector) => needsDead(selector, dead))
                .map(() => file);
        });

        expect(stuck).toEqual([]);
    });
});
