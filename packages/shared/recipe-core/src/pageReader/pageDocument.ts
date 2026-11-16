/**
 * A pasted page as a tree the extractors can ask questions of.
 *
 * DESIGN PATTERN: **Adapter** over `htmlparser2`, the ONLY importer of it. It translates a library
 * tree into the small {@link PageDocument} and {@link PageElement} interfaces and holds NO extraction logic, so the
 * strategies depend on these two interfaces and the parser can be replaced in this one file.
 *
 * ⛔ Parsing only: nothing in a page is executed, fetched or rendered. Every walk here is ITERATIVE (an explicit stack),
 * because a hostile page can nest a hundred thousand elements and a recursive walk would overflow the stack. No regular
 * expression runs over the page or over text taken from it, except `\s+`, which is linear.
 */
import { DomHandler, ElementType, Parser } from 'htmlparser2';

import { MAX_VISIBLE_NODES, MAX_WALK_NODES } from './pageCaps.js';

type DomDocument = DomHandler['root'];
type DomNode = DomDocument['children'][number];
type DomElement = Extract<DomNode, { attribs: unknown }>;
type DomText = Extract<DomNode, { type: ElementType.ElementType.Text }>;

const isTag = (node: DomNode): node is DomElement => ElementType.isTag(node);
const isText = (node: DomNode): node is DomText => node.type === ElementType.ElementType.Text;

/** One element of a pasted page. */
export interface PageElement {
    /** The lower-case tag name. */
    readonly tag: string;
    /** The attribute's value (entities decoded), or `undefined` when the element has none. */
    attr(name: string): string | undefined;
    /** The element's child ELEMENTS, in order. */
    children(): readonly PageElement[];
    /**
     * The element's visible text in blocks: a new block starts at a block element or a line break. At most
     * {@link MAX_WALK_NODES} nodes are read, and `truncated` says that cap cut the text short.
     */
    blocks(): { readonly blocks: readonly string[]; readonly truncated: boolean };
    /** The same blocks, read to the page's own budget ({@link MAX_VISIBLE_NODES}), and whether that budget cut them short. */
    visibleText(): { readonly blocks: readonly string[]; readonly truncated: boolean };
    /** The text children exactly as written, with no entity decoding. For a `<script>`, its source. */
    rawText(): string;
}

/** A pasted page. */
export interface PageDocument {
    /** Whether parsing stopped early because the page nests past {@link MAX_ELEMENT_DEPTH}; what follows was not read. */
    readonly truncated: boolean;
    /** Every element with this lower-case tag, in document order. */
    byTag(tag: string): readonly PageElement[];
    /** Every element that carries this attribute (even an empty one), in document order. */
    withAttribute(name: string): readonly PageElement[];
}

/** Elements whose start and end break the text into blocks. */
const BLOCK_TAGS: ReadonlySet<string> = new Set([
    'address',
    'article',
    'aside',
    'blockquote',
    'br',
    'dd',
    'details',
    'div',
    'dl',
    'dt',
    'fieldset',
    'figcaption',
    'figure',
    'footer',
    'form',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'header',
    'hr',
    'li',
    'main',
    'nav',
    'ol',
    'p',
    'pre',
    'section',
    'table',
    'tr',
    'ul',
]);

/** Elements whose content is code or style, never text a cook reads. */
const NON_TEXT_TAGS: ReadonlySet<string> = new Set(['script', 'style']);

/** The most times {@link plainText} reads a value again to undo an earlier encoding. */
const MAX_DECODE_PASSES = 2;

/**
 * The deepest element nesting the page is read to. Real pages nest a few dozen levels. htmlparser2 keeps its open elements
 * in an array it shifts from the front, so its cost grows with the SQUARE of the depth (measured: 100,000 nested `<div>`
 * take 2 s to parse, 200,000 take 8 s, 400,000 take 20 s), and a hostile paste could stall the device. Past this depth the
 * parse STOPS and the page is marked {@link PageDocument.truncated}.
 */
export const MAX_ELEMENT_DEPTH = 256;

/** Characters fed to the parser at a time, so the depth is checked often enough that overshooting the cap costs little. */
const PARSE_CHUNK_CHARS = 16_384;

/** htmlparser2's own tree builder, which notes when the element depth passes {@link MAX_ELEMENT_DEPTH}. */
class DepthWatchingHandler extends DomHandler {
    private depth = 0;
    public tooDeep = false;

    public override onopentag(name: string, attribs: Record<string, string>): void {
        this.depth += 1;
        this.tooDeep = this.tooDeep || this.depth > MAX_ELEMENT_DEPTH;
        super.onopentag(name, attribs);
    }

    public override onclosetag(): void {
        this.depth -= 1;
        super.onclosetag();
    }
}

/** Parse `html` into htmlparser2's tree, and say whether it stopped early for depth. It never throws: bad markup is repaired. */
function parseDocument(html: string): { readonly root: DomDocument; readonly truncated: boolean } {
    const handler = new DepthWatchingHandler();
    const parser = new Parser(handler);

    for (let start = 0; start < html.length && !handler.tooDeep; start += PARSE_CHUNK_CHARS) {
        parser.write(html.slice(start, start + PARSE_CHUNK_CHARS));
    }

    parser.end();

    return { root: handler.root, truncated: handler.tooDeep };
}

/** Push `children` on `stack` last first, so they pop in order. */
function pushReversed<T>(stack: T[], children: readonly T[]): void {
    for (let index = children.length - 1; index >= 0; index -= 1) {
        const child = children[index];

        if (child !== undefined) {
            stack.push(child);
        }
    }
}

const collapseSpace = (text: string): string =>
    text
        .split(/\s+/u)
        .filter((word) => word !== '')
        .join(' ');

/**
 * The text blocks of a list of nodes, in order. One explicit stack, so depth costs memory and never the call stack.
 *
 * ⛔ At most {@link MAX_WALK_NODES} nodes are read, so one value that wraps a huge subtree costs a bounded walk.
 *
 * @param roots - The nodes to read.
 * @param newlineBreaks - Whether a newline inside text starts a new block (true for a plain string, false for markup,
 *   where a newline is only whitespace).
 */
function blocksOf(
    roots: readonly DomNode[],
    newlineBreaks: boolean,
    maxNodes = MAX_WALK_NODES,
): { readonly blocks: readonly string[]; readonly truncated: boolean } {
    const blocks: string[] = [];
    let current = '';

    const flush = (): void => {
        const text = collapseSpace(current);

        if (text !== '') {
            blocks.push(text);
        }

        current = '';
    };

    const addText = (data: string): void => {
        if (!newlineBreaks) {
            current += data;

            return;
        }

        data.split(/\r\n|\r|\n/u).forEach((line, index) => {
            if (index > 0) {
                flush();
            }

            current += line;
        });
    };

    // A node to read, or `null` marking the end of a block element.
    const stack: (DomNode | null)[] = [...roots].reverse();

    let visited = 0;
    let next = stack.pop();

    for (; next !== undefined && visited <= maxNodes; next = stack.pop()) {
        visited += 1;

        if (next === null) {
            flush();
        } else if (isText(next)) {
            addText(next.data);
        } else if (isTag(next) && !NON_TEXT_TAGS.has(next.name)) {
            if (BLOCK_TAGS.has(next.name)) {
                flush();
                stack.push(null);
            }

            pushReversed(stack, next.children);
        }
    }

    flush();

    return { blocks, truncated: next !== undefined };
}

/**
 * The text blocks of a string of markup: tags removed, entities decoded, whitespace collapsed, blank blocks dropped. A
 * block starts at a block element, a `<br>` and a newline.
 *
 * @param html - A value taken from a page, such as a JSON-LD step that holds `<p>` tags.
 * @returns The non-blank blocks, in order. Pure.
 */
export function textBlocks(html: string): readonly string[] {
    return blocksOf(parseDocument(html).root.children, true).blocks;
}

/**
 * Whether reading `html` as text would stop early: its markup nests past the parse depth cap, or holds more than
 * {@link MAX_WALK_NODES} nodes. Text with no `<` has one node and is never cut.
 *
 * @param html - A value taken from a page.
 * @returns `true` when {@link textBlocks} and {@link plainText} would lose part of it. Pure.
 */
export function isTextCut(html: string): boolean {
    if (!html.includes('<')) {
        return false;
    }

    const { root, truncated } = parseDocument(html);

    return truncated || blocksOf(root.children, true).truncated;
}

/**
 * A value's text on ONE line: its blocks joined by a space. Entities are decoded and tags removed by the parser, and a
 * value that was encoded twice (`&amp;amp;`, `&lt;b&gt;`) is read once more, so the cook never sees markup.
 *
 * @param html - A value taken from a page.
 * @returns The text, empty when there is none. Pure.
 */
export function plainText(html: string): string {
    let text = html;

    for (let pass = 0; pass < MAX_DECODE_PASSES; pass += 1) {
        if (!text.includes('&') && !text.includes('<')) {
            break;
        }

        const read = textBlocks(text).join(' ');

        if (read === text) {
            break;
        }

        text = read;
    }

    return collapseSpace(text);
}

/** File `element` under `key` in a one-to-many index. */
function filed(index: Map<string, DomElement[]>, key: string, element: DomElement): void {
    const list = index.get(key);

    if (list === undefined) {
        index.set(key, [element]);
    } else {
        list.push(element);
    }
}

function elementView(node: DomNode): PageElement | undefined {
    if (!isTag(node)) {
        return undefined;
    }

    return {
        tag: node.name,
        attr: (name) => (Object.hasOwn(node.attribs, name) ? node.attribs[name] : undefined),
        children: () => node.children.flatMap((child) => elementView(child) ?? []),
        blocks: () => blocksOf(node.children, false),
        visibleText: () => blocksOf(node.children, false, MAX_VISIBLE_NODES),
        rawText: () => node.children.map((child) => (isText(child) ? child.data : '')).join(''),
    };
}

/**
 * Parse a paste as a page.
 *
 * @param html - The pasted text.
 * @returns The page. htmlparser2 never throws on bad markup; it repairs it. Pure.
 */
export function parsePage(html: string): PageDocument {
    const { root, truncated } = parseDocument(html);

    // One walk, once: every element is filed under its tag and under each attribute it carries, in document order. A
    // lookup is then a map read, not a walk of the whole page.
    const byTagName = new Map<string, DomElement[]>();
    const byAttribute = new Map<string, DomElement[]>();
    const stack: DomNode[] = [...root.children].reverse();

    for (let next = stack.pop(); next !== undefined; next = stack.pop()) {
        if (isTag(next)) {
            filed(byTagName, next.name, next);
            Object.keys(next.attribs).forEach((name) => filed(byAttribute, name, next));
            pushReversed(stack, next.children);
        }
    }

    const viewsOf = (index: Map<string, DomElement[]>, key: string): readonly PageElement[] =>
        (index.get(key) ?? []).flatMap((element) => elementView(element) ?? []);

    return {
        truncated,
        byTag: (tag) => viewsOf(byTagName, tag),
        withAttribute: (name) => viewsOf(byAttribute, name),
    };
}
