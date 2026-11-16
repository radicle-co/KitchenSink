/**
 * What a page shows a cook, as tokens that a run can be looked up in: the one thing the corroboration stage and the
 * step-name check ask of a page.
 *
 * DESIGN PATTERN: **Adapter** over {@link PageDocument}, narrowed to two questions, "is this run of tokens on the page" and
 * "does the page show exactly this list, no more". It is built once per paste and holds no extraction logic.
 *
 * ⛔ A page is hostile input, so the read is bounded three ways. The body is read to `MAX_VISIBLE_NODES` (`pageCaps.ts`) nodes and
 * {@link MAX_VISIBLE_TOKENS} tokens, and a page past either is `tooComplex`, never half read. A lookup goes through an index
 * of the RAREST token of the run (an index of every token's positions), not a scan of every position, and all lookups of one paste share one budget of
 * {@link MAX_TOKEN_COMPARISONS} comparisons: a page that repeats one token thousands of times answers `overBudget`.
 * Only linear whitespace and newline splits run over page text, and no pattern can backtrack.
 */
import { MAX_TOKEN_COMPARISONS, MAX_VISIBLE_TOKENS } from './pageCaps.js';
import type { ElementExtent, PageDocument, VisibleBlock } from './pageDocument.js';
import { tokensOf } from './pageTokens.js';

/** Whether a run was found, was not, or could not be looked for within the page's comparison budget. */
export type RunLookup = 'found' | 'absent' | 'overBudget';

/** Whether the page shows exactly a list, shows something else, or could not be checked within its comparison budget. */
export type ListLookup = 'matches' | 'differs' | 'overBudget';

/** The visible text of one page. */
export interface VisibleText {
    /**
     * Look for a run of tokens in the page's visible text, blocks run together.
     *
     * @param run - The tokens, in order.
     * @param endsBlock - Whether the run must END where a visible block (a list item, a paragraph) ends.
     */
    find(run: readonly string[], endsBlock: boolean): RunLookup;

    /**
     * Whether the page shows these lists as ONE card, each in order, and nothing else in the lists of that card: the check
     * that a schema is neither more nor less than the card the cook reads.
     *
     * - Each run of a list is found after the one before it.
     * - Every block of every list a run sits in (the blocks that share its container) must be read by a run, except a
     *   heading, and no block is read by a run in part. A schema that leaves a line out, or reads only the end of one,
     *   therefore differs.
     * - THE CARD is the smallest block element that holds every block a run was read from. Every list item (`<li>`) inside
     *   it must be read too, so a whole list the schema leaves out (an ingredient group, a second method) differs. A
     *   paragraph in the card that no run reads (a note) does not, and nor does a list outside it (the page's menus).
     *
     * @param lists - The lists of the recipe, each with the tokens of its lines in order. A run with no tokens never matches.
     */
    shows(lists: readonly ShownList[]): ListLookup;

    /** The token comparisons the lookups have spent so far: the work a test holds bounded in place of a time budget. */
    comparisonsSpent(): number;
}

/** One list a page must show. */
export interface ShownList {
    readonly runs: readonly (readonly string[])[];
    /**
     * Whether each run must START where a block starts and END where one ends (an ingredient line), or may sit anywhere in a
     * block (a sentence of a step, with its neighbours the rest of the block).
     */
    readonly wholeBlocks: boolean;
}

/** The page's visible text, or why there is none: no `<body>`, or a page too big or too deep to read whole. */
export type VisibleTextResult =
    { readonly kind: 'ok'; readonly text: VisibleText } | { readonly kind: 'noBody' } | { readonly kind: 'tooComplex' };

/**
 * The token of `run` that is rarest on the page, and where it sits there. Starting from it means a run of words that are
 * common on the page ("add", "the") is not tried at every place the first one occurs.
 */
function rarestToken(
    run: readonly string[],
    positions: ReadonlyMap<string, readonly number[]>,
): { readonly anchor: number; readonly anchored: readonly number[] } {
    let anchor = 0;
    let anchored = positions.get(run[0] ?? '') ?? [];

    for (let at = 1; at < run.length; at += 1) {
        const list = positions.get(run[at] ?? '') ?? [];

        if (list.length < anchored.length) {
            anchor = at;
            anchored = list;
        }
    }

    return { anchor, anchored };
}

/** How many of the tokens of `run` before its last one equal the page's tokens from `start`, stopping at the first that differs. */
function matchedPrefix(tokens: readonly string[], run: readonly string[], start: number): number {
    let at = 0;

    while (at < run.length - 1 && tokens[start + at] === run[at]) {
        at += 1;
    }

    return at;
}

/** The index of the first of the ascending `list` that is at least `least`, or its length. */
function firstAtLeast(list: readonly number[], least: number): number {
    let low = 0;
    let high = list.length;

    while (low < high) {
        const middle = (low + high) >>> 1;

        if ((list[middle] ?? 0) < least) {
            low = middle + 1;
        } else {
            high = middle;
        }
    }

    return low;
}

/** A page's tokens, and the blocks they came from. Only a block with a token is one. */
interface Tokenized {
    readonly tokens: readonly string[];
    /** For each token, 1 when it starts a block. */
    readonly blockStarts: Uint8Array;
    /** For each token, 1 when it ends a block. */
    readonly blockEnds: Uint8Array;
    /** For each block, its first and last token and its container. */
    readonly blocks: readonly BlockSpan[];
    /** The block elements of the body, by number (`VisibleBlock.element`). */
    readonly elements: readonly ElementExtent[];
}

interface BlockSpan {
    readonly first: number;
    readonly last: number;
    readonly group: number;
    readonly isHeading: boolean;
    readonly element: number;
    readonly item: number;
}

/** `locate` found no place for the run. */
const ABSENT = -1;
/** `locate` ran past the comparison budget. */
const OVER_BUDGET = -2;

/**
 * The card: the smallest block element that holds every block in `read`, by number. The elements are numbered in document
 * order, so it is the nearest ancestor of the first-numbered block whose range reaches the last-numbered one.
 */
function cardOf(elements: readonly ElementExtent[], read: readonly BlockSpan[]): number {
    let lowest = Number.POSITIVE_INFINITY;
    let highest = 0;

    for (const block of read) {
        lowest = Math.min(lowest, block.element);
        highest = Math.max(highest, block.element);
    }

    let card = Number.isFinite(lowest) ? lowest : 0;

    while (card > 0 && (elements[card]?.last ?? 0) < highest) {
        card = elements[card]?.parent ?? 0;
    }

    return card;
}

/** Whether the blocks that runs were read from leave a line of their list, or a list item of their card, unread. */
function leavesLinesUnread({ blocks, elements }: Tokenized, covered: Uint8Array): boolean {
    const touched = new Set<number>();
    const read: BlockSpan[] = [];
    const unread: BlockSpan[] = [];

    for (const block of blocks) {
        let reads = 0;

        for (let at = block.first; at <= block.last; at += 1) {
            reads += covered[at] ?? 0;
        }

        if (reads > 0) {
            touched.add(block.group);
            read.push(block);
        }

        if (reads > 0 && reads < block.last - block.first + 1) {
            // Read in part: a line of the page whose other words the schema does not state.
            return true;
        }

        if (reads === 0 && !block.isHeading) {
            unread.push(block);
        }
    }

    const card = cardOf(elements, read);
    const cardLast = elements[card]?.last ?? 0;

    // Loose text (group 0) is not a list: any other block is a line of the list its siblings are. A list item inside the
    // card (its `<li>` numbered after the card's own, and within its range) is a line of the card.
    return unread.some(
        (block) => (block.group !== 0 && touched.has(block.group)) || (block.item > card && block.item <= cardLast),
    );
}

/** The first-token index, the block marks and the comparison budget of one page's tokens. */
function textOfTokens(page: Tokenized): VisibleText {
    const { tokens, blockStarts, blockEnds } = page;
    const positions = new Map<string, number[]>();

    tokens.forEach((token, position) => {
        const list = positions.get(token);

        if (list === undefined) {
            positions.set(token, [position]);
        } else {
            list.push(position);
        }
    });

    let comparisons = 0;

    /** Where the first place at or after `from` that shows `run` starts, {@link ABSENT}, or {@link OVER_BUDGET}. */
    const locate = (run: readonly string[], from: number, startsBlock: boolean, endsBlock: boolean): number => {
        const last = run.length - 1;
        const { anchor, anchored } = rarestToken(run, positions);

        comparisons += run.length;

        for (let at = firstAtLeast(anchored, from + anchor); at < anchored.length; at += 1) {
            const start = (anchored[at] ?? 0) - anchor;
            const end = start + last;

            comparisons += 1;

            if (comparisons > MAX_TOKEN_COMPARISONS) {
                return OVER_BUDGET;
            }

            if (
                end < tokens.length &&
                tokens[end] === run[last] &&
                (!endsBlock || blockEnds[end] === 1) &&
                (!startsBlock || blockStarts[start] === 1)
            ) {
                const matched = matchedPrefix(tokens, run, start);

                comparisons += matched;

                if (matched >= last) {
                    return start;
                }
            }
        }

        return ABSENT;
    };

    return {
        find: (run, endsBlock) => {
            if (run.length === 0) {
                return 'found';
            }

            const start = locate(run, 0, false, endsBlock);

            if (start === OVER_BUDGET) {
                return 'overBudget';
            }

            return start === ABSENT ? 'absent' : 'found';
        },
        shows: (lists) => {
            const covered = new Uint8Array(tokens.length);

            for (const { runs, wholeBlocks } of lists) {
                let cursor = 0;

                for (const run of runs) {
                    const start = run.length === 0 ? ABSENT : locate(run, cursor, wholeBlocks, wholeBlocks);

                    if (start === OVER_BUDGET) {
                        return 'overBudget';
                    }

                    if (start === ABSENT) {
                        return 'differs';
                    }

                    covered.fill(1, start, start + run.length);
                    cursor = start + run.length;
                }
            }

            return leavesLinesUnread(page, covered) ? 'differs' : 'matches';
        },
        comparisonsSpent: () => comparisons,
    };
}

/** The tokens of `blocks`, or `undefined` when they pass {@link MAX_VISIBLE_TOKENS}: a page that long is never half read. */
function tokenizedBlocks(blocks: readonly VisibleBlock[], elements: readonly ElementExtent[]): Tokenized | undefined {
    const tokens: string[] = [];
    const spans: BlockSpan[] = [];

    for (const block of blocks) {
        const first = tokens.length;

        for (const token of tokensOf(block.text)) {
            tokens.push(token);
        }

        if (tokens.length > MAX_VISIBLE_TOKENS) {
            return undefined;
        }

        if (tokens.length > first) {
            spans.push({
                first,
                last: tokens.length - 1,
                group: block.group,
                isHeading: block.isHeading,
                element: block.element,
                item: block.item,
            });
        }
    }

    const blockStarts = new Uint8Array(tokens.length);
    const blockEnds = new Uint8Array(tokens.length);

    spans.forEach((span) => {
        blockStarts[span.first] = 1;
        blockEnds[span.last] = 1;
    });

    return { tokens, blockStarts, blockEnds, blocks: spans, elements };
}

/**
 * Read what a page shows.
 *
 * @param page - The parsed paste.
 * @returns `ok` with the text, `noBody` when the paste has no `<body>`, or `tooComplex` when the page was cut for depth or
 *   its body is past the node or token cap. Pure apart from the budget the returned text spends as it is asked.
 */
export function visibleTextOf(page: PageDocument): VisibleTextResult {
    if (page.truncated) {
        return { kind: 'tooComplex' };
    }

    const [body] = page.byTag('body');

    if (body === undefined) {
        return { kind: 'noBody' };
    }

    const { blocks, elements, truncated } = body.visibleText();

    if (truncated) {
        return { kind: 'tooComplex' };
    }

    const tokenized = tokenizedBlocks(blocks, elements);

    return tokenized === undefined ? { kind: 'tooComplex' } : { kind: 'ok', text: textOfTokens(tokenized) };
}

/**
 * {@link visibleTextOf} for a page, read at most once: the first ask reads the page, and every later ask gets the same answer
 * (and the same comparison budget).
 *
 * @param page - The parsed paste.
 * @returns A function that gives the page's visible text. Pure apart from that cache.
 */
export function memoizedVisibleText(page: PageDocument): () => VisibleTextResult {
    let read: VisibleTextResult | undefined;

    return () => {
        read ??= visibleTextOf(page);

        return read;
    };
}
