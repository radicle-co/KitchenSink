/**
 * Reads one screen board: the text of each `<style>` with where it sits in the board's source, and the set of classes the
 * board uses. This is the one definition of "used": the dead-selector guard and the pruner both read a board through it,
 * so they cannot disagree about which classes are dead.
 *
 * A class counts as used when it appears in any `class` attribute, or anywhere in a `<script>`: every board carries a
 * script, and a class that script sets at run time is not dead. Missing a dead rule is the safe mistake; failing a live
 * one is not.
 */
import { defaultTreeAdapter, parse, type DefaultTreeAdapterMap } from 'parse5';

type Node = DefaultTreeAdapterMap['node'];

export interface StyleBlock {
    /** The stylesheet text parse5 read from the `<style>`. */
    readonly text: string;
    /**
     * Where `text` starts in the board's source, only when the source from there holds exactly `text` (one text child,
     * no entity or newline rewriting). Without it the block cannot be edited by offset, and is left alone.
     */
    readonly offset: number | undefined;
}

export interface BoardReading {
    readonly styles: readonly StyleBlock[];
    readonly used: ReadonlySet<string>;
}

const TOKEN = /[\w-]+/gu;

/** The child nodes of a node: a `<template>`'s content is a fragment of its own, not part of `childNodes`. Pure. */
function childrenOf(node: Node): readonly Node[] {
    if ('content' in node) {
        return [node.content];
    }

    return 'childNodes' in node ? node.childNodes : [];
}

/**
 * The block of one `<style>` element. Pure.
 *
 * @param html - The board's source, which the element was parsed from.
 */
function styleBlock(html: string, children: readonly Node[]): StyleBlock {
    const text = children.map((child) => (defaultTreeAdapter.isTextNode(child) ? child.value : '')).join('');
    const [only] = children;
    const where = children.length === 1 && only && defaultTreeAdapter.isTextNode(only) ? only.sourceCodeLocation : null;
    const editable = where && html.slice(where.startOffset, where.endOffset) === text;

    return { text, offset: editable ? where.startOffset : undefined };
}

/**
 * Walks the board once, adding to `styles` and `used`.
 *
 * @sideEffect Mutates `styles` and `used`.
 */
function read(html: string, node: Node, styles: StyleBlock[], used: Set<string>): void {
    if (defaultTreeAdapter.isElementNode(node)) {
        if (node.tagName === 'style') {
            styles.push(styleBlock(html, node.childNodes));

            return;
        }

        if (node.tagName === 'script') {
            const text = node.childNodes.map((c) => (defaultTreeAdapter.isTextNode(c) ? c.value : '')).join('');
            (text.match(TOKEN) ?? []).forEach((token) => used.add(token));
        }

        node.attrs
            .filter((attr) => attr.name === 'class')
            .flatMap((attr) => attr.value.split(/\s+/u))
            .forEach((token) => used.add(token));
    }

    childrenOf(node).forEach((child) => read(html, child, styles, used));
}

/**
 * Reads a board. Pure.
 *
 * @param html - The board's source.
 */
export function readBoard(html: string): BoardReading {
    const styles: StyleBlock[] = [];
    const used = new Set<string>();

    read(html, parse(html, { sourceCodeLocationInfo: true }), styles, used);

    return { styles, used };
}
