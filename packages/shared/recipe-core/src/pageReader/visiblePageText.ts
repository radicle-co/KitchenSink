/**
 * What a page shows a cook, as tokens that a run can be looked up in: the one thing the corroboration stage and the
 * step-name check ask of a page.
 *
 * DESIGN PATTERN: **Adapter** over {@link PageDocument}, narrowed to one question, "is this run of tokens on the page".
 * It is built once per paste and holds no extraction logic.
 *
 * ⛔ A page is hostile input, so the read is bounded three ways. The body is read to `MAX_VISIBLE_NODES` (`pageCaps.ts`) nodes and
 * {@link MAX_VISIBLE_TOKENS} tokens, and a page past either is `tooComplex`, never half read. A lookup goes through an index
 * of the RAREST token of the run (an index of every token's positions), not a scan of every position, and all lookups of one paste share one budget of
 * {@link MAX_TOKEN_COMPARISONS} comparisons: a page that repeats one token thousands of times answers `overBudget`.
 * Only linear whitespace and newline splits run over page text, and no pattern can backtrack.
 */
import { MAX_TOKEN_COMPARISONS, MAX_VISIBLE_TOKENS } from './pageCaps.js';
import type { PageDocument } from './pageDocument.js';
import { tokensOf } from './pageTokens.js';

/** Whether a run was found, was not, or could not be looked for within the page's comparison budget. */
export type RunLookup = 'found' | 'absent' | 'overBudget';

/** The visible text of one page. */
export interface VisibleText {
    /**
     * Look for a run of tokens in the page's visible text, blocks run together.
     *
     * @param run - The tokens, in order.
     * @param endsBlock - Whether the run must END where a visible block (a list item, a paragraph) ends.
     */
    find(run: readonly string[], endsBlock: boolean): RunLookup;
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

/** The first-token index and the block ends of one page's tokens. */
function textOfTokens(tokens: readonly string[], blockEnds: Uint8Array): VisibleText {
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

    return {
        find: (run, endsBlock) => {
            const last = run.length - 1;

            if (last < 0) {
                return 'found';
            }

            const { anchor, anchored } = rarestToken(run, positions);

            comparisons += run.length;

            for (const position of anchored) {
                const start = position - anchor;
                const end = start + last;

                comparisons += 1;

                if (comparisons > MAX_TOKEN_COMPARISONS) {
                    return 'overBudget';
                }

                if (
                    start >= 0 &&
                    end < tokens.length &&
                    tokens[end] === run[last] &&
                    (!endsBlock || blockEnds[end] === 1)
                ) {
                    const matched = matchedPrefix(tokens, run, start);

                    comparisons += matched;

                    if (matched >= last) {
                        return 'found';
                    }
                }
            }

            return 'absent';
        },
    };
}

/** A page's tokens, and a flag for each that ends a block. */
interface Tokenized {
    readonly tokens: readonly string[];
    readonly blockEnds: Uint8Array;
}

/** The tokens of `blocks`, or `undefined` when they pass {@link MAX_VISIBLE_TOKENS}: a page that long is never half read. */
function tokenizedBlocks(blocks: readonly string[]): Tokenized | undefined {
    const tokens: string[] = [];
    const ends: number[] = [];

    for (const block of blocks) {
        for (const token of tokensOf(block)) {
            tokens.push(token);
        }

        if (tokens.length > MAX_VISIBLE_TOKENS) {
            return undefined;
        }

        if (tokens.length > 0) {
            ends.push(tokens.length - 1);
        }
    }

    const blockEnds = new Uint8Array(tokens.length);

    ends.forEach((end) => {
        blockEnds[end] = 1;
    });

    return { tokens, blockEnds };
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

    const { blocks, truncated } = body.visibleText();

    if (truncated) {
        return { kind: 'tooComplex' };
    }

    const tokenized = tokenizedBlocks(blocks);

    return tokenized === undefined
        ? { kind: 'tooComplex' }
        : { kind: 'ok', text: textOfTokens(tokenized.tokens, tokenized.blockEnds) };
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
