/**
 * Reads one screen board: the text of each `<style>` with where it sits in the board's source, and the set of classes the
 * board uses. It is the one definition of "used", and {@link classNameOf} is the one way a selector's class is spelled.
 *
 * A class counts as used when it appears in any `class` attribute, or anywhere in a `<script>`: every board carries a
 * script, and a class that script sets at run time is not dead. Missing a dead rule is the safe mistake; failing a live
 * one is not.
 */
import { ident, type ClassSelector } from 'css-tree';
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

/** Word tokens, and the wider runs a class like `md:flex` or `w-1/2` is written as in a script. Both are counted used. */
const TOKENS = [/[\w-]+/gu, /[^\s'"`,;()[\]{}<>=+]+/gu];

/** A class selector's name as the `class` attribute spells it: css-tree keeps the escapes (`md\:flex`), the DOM does not. Pure. */
export function classNameOf(selector: ClassSelector): string {
    return ident.decode(selector.name);
}

/** The text of the text nodes among `children`, joined. Pure. */
function textOf(children: readonly Node[]): string {
    return children.map((child) => (defaultTreeAdapter.isTextNode(child) ? child.value : '')).join('');
}

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
    const text = textOf(children);
    const [only] = children;
    const where = children.length === 1 && only && defaultTreeAdapter.isTextNode(only) ? only.sourceCodeLocation : null;
    const editable = where && html.slice(where.startOffset, where.endOffset) === text;

    return { text, offset: editable ? where.startOffset : undefined };
}

/** Every word a script's text holds, by each way of cutting it into tokens. Pure. */
function scriptWordsOf(script: string): string[] {
    return TOKENS.flatMap((token) => Array.from(script.matchAll(token), ([word]) => word));
}

/** The tokens of an element's `class` attributes. Pure. */
function classTokensOf(element: DefaultTreeAdapterMap['element']): string[] {
    return element.attrs.filter(({ name }) => name === 'class').flatMap(({ value }) => value.split(/\s+/u));
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

        const words = node.tagName === 'script' ? scriptWordsOf(textOf(node.childNodes)) : [];

        for (const word of [...words, ...classTokensOf(node)]) {
            used.add(word);
        }
    }

    for (const child of childrenOf(node)) {
        read(html, child, styles, used);
    }
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
