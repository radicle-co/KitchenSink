/**
 * Removes from a board the CSS rules that need a class no element of the board carries.
 *
 * The board is edited by source offsets, never re-serialised: the bytes outside a removed span are kept, so a prune
 * shows up in a diff as the removed rules and nothing else. The dead set comes from {@link deadClassSelectors}, and the
 * board's `<style>` blocks from {@link readBoard}; this module has no idea of "used" of its own.
 *
 * Only a rule that CANNOT match is removed. A selector that names a dead class inside `:not()`, or in a list with a
 * live item, still matches, so it stays and its class is left for the guard to report.
 */
import { parse as parseCss, type CssNode, type Selector } from 'css-tree';

import { classNameOf, readBoard } from './boardReading.js';
import { deadClassSelectors } from './deadClassSelectors.js';

/** A span of the board's source to delete. */
interface Cut {
    readonly start: number;
    readonly end: number;
}

interface Outcome {
    readonly cuts: readonly Cut[];
    readonly selectors: number;
    /** Every child was removed (and there was at least one), so the parent may go whole. */
    readonly emptied: boolean;
}

/** The pseudo-classes whose list matches when ANY item does, and so cannot match when every item cannot. */
const MATCH_ANY = new Set(['is', 'where', 'matches', '-webkit-any', '-moz-any', 'has']);
const CONDITIONAL = new Set(['media', 'container', 'supports']);

/**
 * Whether a selector can never match, because it needs a dead class: in its own compound chain, or in a
 * `:is()`/`:where()`/`:has()` list where every item needs one. Never through `:not()`. Pure.
 */
function requiresDeadClass(node: CssNode, dead: ReadonlySet<string>): boolean {
    switch (node.type) {
        case 'ClassSelector':
            return dead.has(classNameOf(node));
        case 'PseudoClassSelector':
            return (
                MATCH_ANY.has(node.name.toLowerCase()) &&
                (node.children?.toArray().some((c) => listRequires(c, dead)) ?? false)
            );
        case 'Selector':
            return node.children.toArray().some((child) => requiresDeadClass(child, dead));
        default:
            return false;
    }
}

/** A list needs a dead class when it has items and every item does. Pure. */
function listRequires(node: CssNode, dead: ReadonlySet<string>): boolean {
    return (
        node.type === 'SelectorList' &&
        node.children.size > 0 &&
        node.children.toArray().every((item) => requiresDeadClass(item, dead))
    );
}

/** The offsets of a located node. */
function span(node: CssNode, base: number): Cut {
    if (!node.loc) {
        throw new Error('pruneDeadClassRules: a node has no source location; parse with positions: true');
    }

    return { start: base + node.loc.start.offset, end: base + node.loc.end.offset };
}

/** Widens a cut over its whole line when nothing else shares it, so no blank line is left behind. Pure. */
function wholeLine(cut: Cut, html: string, ceiling: number): Cut {
    const lineStart = html.lastIndexOf('\n', cut.start - 1) + 1;
    const newline = html.indexOf('\n', cut.end);
    const lineEnd = newline === -1 || newline >= ceiling ? ceiling : newline + 1;
    const alone =
        /^[ \t]*$/u.test(html.slice(lineStart, cut.start)) && /^[ \t\r]*\n?$/u.test(html.slice(cut.end, lineEnd));

    return alone ? { start: lineStart, end: lineEnd } : cut;
}

/** The cut that deletes one run of removed items, leaving the kept items' separators alone. Pure. */
function runCut(
    run: readonly Selector[],
    before: Selector | undefined,
    after: Selector | undefined,
    base: number,
): Cut[] {
    const first = run.at(0);
    const last = run.at(-1);

    if (first === undefined || last === undefined) {
        return [];
    }

    // At the list start the run goes up to the next kept item; otherwise from the previous kept item's end.
    if (before === undefined) {
        return after === undefined ? [] : [{ start: span(first, base).start, end: span(after, base).start }];
    }

    return [{ start: span(before, base).end, end: span(last, base).end }];
}

/** The cuts that delete the items at `gone` from a list that keeps the rest. Pure. */
function listCuts(items: readonly Selector[], gone: readonly boolean[], base: number): Cut[] {
    const cuts: Cut[] = [];
    let before: Selector | undefined;
    let run: Selector[] = [];

    for (const [index, item] of items.entries()) {
        if (gone[index]) {
            run.push(item);
        } else {
            cuts.push(...runCut(run, before, item, base));
            run = [];
            before = item;
        }
    }

    cuts.push(...runCut(run, before, undefined, base));

    return cuts;
}

interface Context {
    readonly html: string;
    readonly dead: ReadonlySet<string>;
    /** Where the `<style>` text starts in `html`, and where it ends. */
    readonly base: number;
    readonly limit: number;
}

/** What to cut for the children of a stylesheet or a conditional block. */
function pruneChildren(children: readonly CssNode[], context: Context): Outcome {
    const cuts: Cut[] = [];
    let selectors = 0;
    let removedChildren = 0;

    for (const child of children) {
        const outcome = pruneNode(child, context);

        cuts.push(...outcome.cuts);
        selectors += outcome.selectors;
        removedChildren += outcome.emptied ? 1 : 0;
    }

    return { cuts, selectors, emptied: children.length > 0 && removedChildren === children.length };
}

/** What to cut for one rule or at-rule. `emptied` means the node goes whole and `cuts` holds that one cut. */
function pruneNode(node: CssNode, context: Context): Outcome {
    const none: Outcome = { cuts: [], selectors: 0, emptied: false };
    const { html, dead, base, limit } = context;

    if (node.type === 'Rule' && node.prelude.type === 'SelectorList') {
        const items = node.prelude.children.toArray().filter((item): item is Selector => item.type === 'Selector');
        const gone = items.map((item) => requiresDeadClass(item, dead));
        const count = gone.filter(Boolean).length;

        if (count === 0) {
            return none;
        }

        if (count === items.length) {
            return { cuts: [wholeLine(span(node, base), html, limit)], selectors: count, emptied: true };
        }

        return { cuts: listCuts(items, gone, base), selectors: count, emptied: false };
    }

    if (node.type === 'Atrule' && node.block) {
        const name = node.name.toLowerCase();
        const inner = pruneChildren(node.block.children.toArray(), context);

        if (CONDITIONAL.has(name) && inner.emptied) {
            return {
                cuts: [wholeLine(span(node, base), html, limit)],
                selectors: inner.selectors,
                emptied: true,
            };
        }

        // A layer's block is pruned but the layer stays (its name fixes the cascade order). Other at-rules are untouched.
        return CONDITIONAL.has(name) || name === 'layer' ? { ...inner, emptied: false } : none;
    }

    return none;
}

/** Applies the cuts to `html`, last first so earlier offsets stay true. Pure. */
function applyCuts(html: string, cuts: readonly Cut[]): string {
    return [...cuts]
        .sort((a, b) => b.start - a.start)
        .reduce((text, { start, end }) => text.slice(0, start) + text.slice(end), html);
}

/**
 * The board with its dead-class rules removed, and how many selectors went. Pure.
 *
 * @param html - The board's source.
 */
export function pruneBoard(html: string): { readonly html: string; readonly removed: number } {
    const dead = new Set(deadClassSelectors(html));

    if (dead.size === 0) {
        return { html, removed: 0 };
    }

    const outcomes = readBoard(html).styles.flatMap(({ text, offset }) => {
        if (offset === undefined) {
            return [];
        }

        const sheet = parseCss(text, { positions: true });

        return sheet.type === 'StyleSheet'
            ? [pruneChildren(sheet.children.toArray(), { html, dead, base: offset, limit: offset + text.length })]
            : [];
    });

    return {
        html: applyCuts(
            html,
            outcomes.flatMap(({ cuts }) => cuts),
        ),
        removed: outcomes.reduce((sum, { selectors }) => sum + selectors, 0),
    };
}

/**
 * The board with its dead-class rules removed. Pure, idempotent, and every byte outside a removed span is kept.
 *
 * @param html - The board's source.
 */
export function pruneDeadClassRules(html: string): string {
    return pruneBoard(html).html;
}
