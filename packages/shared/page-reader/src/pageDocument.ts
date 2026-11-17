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

/** One visible block of text, and where it sits. */
export interface VisibleBlock {
    readonly text: string;
    /**
     * Which container the block is a line of: blocks with one `group` are siblings (the items of one list, the lines of
     * one paragraph). A block that is not inside any block element is in group 0.
     */
    readonly group: number;
    /** Whether the block is a heading or a caption, which labels a list and is no line of it. */
    readonly isHeading: boolean;
    /** The block element the block is read from, as its number in {@link VisibleRead.elements} (0: none). */
    readonly element: number;
    /** The nearest `<li>` the block sits in, as its element number (0: none). */
    readonly item: number;
    /** Whether that `<li>` is an item of an ordered list (`<ol>`), as a method is. */
    readonly ordered: boolean;
}

/** Where a block element sits among the others: numbered in document order, so its descendants are a range. */
export interface ElementExtent {
    /** The number of the block element it sits in (0 for the root, and -1 for the root itself). */
    readonly parent: number;
    /** The number of its last descendant: the block elements inside it are numbered from its own up to this. */
    readonly last: number;
}

/** A body's visible text: its blocks, the block elements they sit in, and whether the read was cut short. */
export interface VisibleRead {
    readonly blocks: readonly VisibleBlock[];
    /** Every block element read, by number; 0 is the root of the read. */
    readonly elements: readonly ElementExtent[];
    readonly truncated: boolean;
}

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
    /**
     * The same blocks, read to the page's own budget (`maxNodes`, by default {@link MAX_VISIBLE_NODES}), each with what the extras check needs
     * to know of where it sits, and whether that budget cut them short.
     */
    visibleText(maxNodes?: number): VisibleRead;
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
    /**
     * The page's size in nodes, and the node visits every read of it has made so far: the work a test holds bounded in
     * place of a time budget. A lookup is a map read and costs none.
     */
    work(): { readonly nodes: number; readonly visits: number };
}

/** The node visits the reads of one page have made. */
interface WorkMeter {
    visits: number;
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

/** Elements that label what follows rather than being a line of it. */
const HEADING_TAGS: ReadonlySet<string> = new Set([
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'legend',
    'figcaption',
    'caption',
    'summary',
]);

/**
 * Elements whose content is code, style, an inert template, a fallback, a form field's value or a tooltip: never text a
 * cook reads. `title` in a body is an SVG's tooltip (the page's own title is in the head, which is never read).
 */
const NON_TEXT_TAGS: ReadonlySet<string> = new Set([
    'script',
    'style',
    'template',
    'noscript',
    'textarea',
    'iframe',
    'noembed',
    'title',
]);

/** The inline style declarations that stop a browser drawing an element. */
const HIDING_STYLES: ReadonlySet<string> = new Set(['display:none', 'visibility:hidden', 'visibility:collapse']);

/** Whether an inline `style` hides its element: a split on `;` and `:`, so the cost is linear in the attribute. */
function styleHides(style: string): boolean {
    return style
        .toLowerCase()
        .split(';')
        .some((declaration) => {
            const [property = '', value = ''] = declaration.split(':');

            return HIDING_STYLES.has(`${property.trim()}:${value.replace('!important', '').trim()}`);
        });
}

/**
 * Whether an element is one a cook cannot see: a non-text tag, the `hidden` attribute, a `<dialog>` that is not open, or an
 * inline style that hides it.
 *
 * ⛔ Text hidden by a CSS CLASS is still read as visible: which classes hide is in the page's stylesheet, and a paste is
 * read without one. A schema that agrees only with such text is therefore not refused by this check.
 */
const isHiddenElement = (element: DomElement): boolean =>
    NON_TEXT_TAGS.has(element.name) ||
    Object.hasOwn(element.attribs, 'hidden') ||
    (element.name === 'dialog' && !Object.hasOwn(element.attribs, 'open')) ||
    styleHides(element.attribs['style'] ?? '');

/** Whether `element` is a `<details>` that is not open, which shows only its `<summary>`. */
const isClosedDetails = (element: DomElement): boolean =>
    element.name === 'details' && !Object.hasOwn(element.attribs, 'open');

const isSummary = (node: DomNode): boolean => isTag(node) && node.name === 'summary';

/** The children a cook sees: of a `<details>` that is not open, only its `<summary>`. */
const shownChildren = (element: DomElement): readonly DomNode[] =>
    isClosedDetails(element) ? element.children.filter(isSummary) : element.children;

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
export const PARSE_CHUNK_CHARS = 16_384;

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

/** The container the text being read belongs to. */
interface Owner {
    readonly group: number;
    readonly isHeading: boolean;
    readonly element: number;
    readonly item: number;
    readonly ordered: boolean;
}

/** The end of a block element: its text is flushed, and the element that held it before is the owner again. */
class BlockEnd {
    public constructor(
        public readonly previous: Owner,
        public readonly element: number,
    ) {}
}

const LOOSE_TEXT: Owner = { group: 0, isHeading: false, element: 0, item: 0, ordered: false };

/**
 * The owner of the text inside block element `node`, numbered `element`, in the list numbered `group`, with
 * A list item starts an item, numbered when its list is an `<ol>`.
 */
function blockOwner(node: DomElement, previous: Owner, element: number, group: number): Owner {
    const isItem = node.name === 'li';
    const inOrderedList = node.parent !== null && 'name' in node.parent && node.parent.name === 'ol';

    return {
        group,
        isHeading: HEADING_TAGS.has(node.name),
        element,
        item: isItem ? element : previous.item,
        ordered: isItem ? inOrderedList : previous.ordered,
    };
}

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
): VisibleRead & { readonly visited: number } {
    const blocks: VisibleBlock[] = [];
    const elements: ElementExtent[] = [{ parent: -1, last: 0 }];
    const groups = new Map<unknown, number>();
    let owner = LOOSE_TEXT;
    let current = '';

    const flush = (): void => {
        const text = collapseSpace(current);

        if (text !== '') {
            blocks.push({
                text,
                group: owner.group,
                isHeading: owner.isHeading,
                element: owner.element,
                item: owner.item,
                ordered: owner.ordered,
            });
        }

        current = '';
    };

    const addText = (node: DomText): void => {
        const { data } = node;

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

    // A node to read, or the end of a block element.
    const stack: (DomNode | BlockEnd)[] = [...roots].reverse();

    let visited = 0;
    let next = stack.pop();

    for (; next !== undefined && visited < maxNodes; next = stack.pop()) {
        visited += 1;

        if (next instanceof BlockEnd) {
            flush();
            elements[next.element] = {
                ...elements[next.element],
                parent: next.previous.element,
                last: elements.length - 1,
            };
            owner = next.previous;
        } else if (isText(next)) {
            addText(next);
        } else if (isTag(next) && !isHiddenElement(next)) {
            if (BLOCK_TAGS.has(next.name)) {
                const element = elements.length;

                flush();
                elements.push({ parent: owner.element, last: element });
                stack.push(new BlockEnd(owner, element));
                groups.set(next.parent, groups.get(next.parent) ?? groups.size + 1);
                owner = blockOwner(next, owner, element, groups.get(next.parent) ?? 0);
            }

            pushReversed(stack, shownChildren(next));
        }
    }

    flush();
    elements[0] = { parent: -1, last: elements.length - 1 };

    return { blocks, elements, truncated: next !== undefined, visited };
}

/**
 * One read of a value as markup: parsed, then its blocks taken, and whether either step stopped early.
 *
 * @param html - A value taken from a page.
 * @returns The non-blank blocks of text, and whether the parse depth cap or the node cap cut the read short.
 */
function readMarkup(html: string): { readonly blocks: readonly string[]; readonly truncated: boolean } {
    const { root, truncated } = parseDocument(html);
    const read = blocksOf(root.children, true);

    return { blocks: read.blocks.map((block) => block.text), truncated: truncated || read.truncated };
}

/**
 * The text blocks of a string of markup: tags removed, entities decoded, whitespace collapsed, blank blocks dropped. A
 * block starts at a block element, a `<br>` and a newline.
 *
 * @param html - A value taken from a page, such as a JSON-LD step that holds `<p>` tags.
 * @returns The non-blank blocks, in order. Pure.
 */
export function textBlocks(html: string): readonly string[] {
    return readMarkup(html).blocks;
}

/**
 * A value read to one line, as {@link plainText} reads it, and whether ANY of its decode passes stopped early. A value
 * written as entities (`&lt;b&gt;`) has no `<` for the first pass to cut, and is markup for the second.
 */
function decodedText(html: string): { readonly text: string; readonly truncated: boolean } {
    let text = html;
    let truncated = false;

    for (let pass = 0; pass < MAX_DECODE_PASSES; pass += 1) {
        if (!text.includes('&') && !text.includes('<')) {
            break;
        }

        const read = readMarkup(text);
        const joinedBlocks = read.blocks.join(' ');

        truncated = truncated || read.truncated;

        if (joinedBlocks === text) {
            break;
        }

        text = joinedBlocks;
    }

    return { text: collapseSpace(text), truncated };
}

/**
 * Whether reading `html` as text would stop early in any of its decode passes: its markup nests past the parse depth cap,
 * or holds more than {@link MAX_WALK_NODES} nodes, as written or once its entities are decoded. Text with no `&` and no
 * `<` is one node and is never cut.
 *
 * @param html - A value taken from a page.
 * @returns `true` when {@link textBlocks} and {@link plainText} would lose part of it. Pure.
 */
export function isTextCut(html: string): boolean {
    return decodedText(html).truncated;
}

/**
 * A value's text on ONE line: its blocks joined by a space. Entities are decoded and tags removed by the parser, and a
 * value that was encoded twice (`&amp;amp;`, `&lt;b&gt;`) is read once more, so the cook never sees markup.
 *
 * @param html - A value taken from a page.
 * @returns The text, empty when there is none. A value a pass stopped early on is cut: the caller asks {@link isTextCut}
 *   first. Pure.
 */
export function plainText(html: string): string {
    return decodedText(html).text;
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

function elementView(node: DomNode, meter: WorkMeter): PageElement | undefined {
    if (!isTag(node)) {
        return undefined;
    }

    /** A walk of the element's nodes, its visits added to the page's meter. */
    const walked = (maxNodes: number): VisibleRead => {
        const { blocks, elements, truncated, visited } = blocksOf(node.children, false, maxNodes);

        meter.visits += visited;

        return { blocks, elements, truncated };
    };

    return {
        tag: node.name,
        attr: (name) => (Object.hasOwn(node.attribs, name) ? node.attribs[name] : undefined),
        children: () => {
            meter.visits += node.children.length;

            return node.children.flatMap((child) => elementView(child, meter) ?? []);
        },
        blocks: () => {
            const read = walked(MAX_WALK_NODES);

            return { blocks: read.blocks.map((block) => block.text), truncated: read.truncated };
        },
        visibleText: (maxNodes = MAX_VISIBLE_NODES) => walked(maxNodes),
        rawText: () => {
            meter.visits += node.children.length;

            return node.children.map((child) => (isText(child) ? child.data : '')).join('');
        },
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
    const meter: WorkMeter = { visits: 0 };
    let nodes = 0;

    for (let next = stack.pop(); next !== undefined; next = stack.pop()) {
        nodes += 1;

        if (isTag(next)) {
            filed(byTagName, next.name, next);
            Object.keys(next.attribs).forEach((name) => filed(byAttribute, name, next));

            pushReversed(stack, next.children);
        }
    }

    meter.visits = nodes;

    const viewsOf = (index: Map<string, DomElement[]>, key: string): readonly PageElement[] =>
        (index.get(key) ?? []).flatMap((element) => elementView(element, meter) ?? []);

    return {
        truncated,
        byTag: (tag) => viewsOf(byTagName, tag),
        withAttribute: (name) => viewsOf(byAttribute, name),
        work: () => ({ nodes, visits: meter.visits }),
    };
}
