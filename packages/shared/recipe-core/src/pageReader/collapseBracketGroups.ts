/**
 * Clean the bracket groups a page's own markup writes badly: `((softened))` becomes `(softened)`.
 *
 * Two more cleanups, for ROUND groups only, each of a shape a template writes when it fills a note in twice:
 * - a group whose content opens with a comma is the rest of the line: `butter (, softened)` becomes `butter, softened`;
 * - a group whose content opens with a whole group and then a comma loses its outer brackets: `((or a pinch), plus a few
 *   sprigs)` becomes `(or a pinch), plus a few sprigs`.
 *
 * The reader cleans the text here; the gate never rewrites. Round and square brackets are read apart, by a character scan
 * (no regular expression runs over page text). Every occurrence is collapsed, an unbalanced bracket is left alone, and the
 * result is a fixed point.
 *
 * ⛔ The text is hostile, so the work is LINEAR and never recursive. One pass over a stack records where each bracket
 * closes ({@link closeIndexes}), and an explicit stack of frames (not the call stack) walks the groups, so a line of
 * 100,000 nested or unclosed brackets costs a scan and cannot overflow the stack. The reader also refuses a line past
 * `PARSE_JOB_LINE_MAX_CHARS` before it gets here (`pageRecipeCandidate.ts`). The steps are COUNTED
 * ({@link collapseBracketGroupsCounted}), so a test proves the work linear without timing it.
 */

/** The steps a collapse has taken: one per character paired, per group walked and per bracket peeled. */
interface Meter {
    steps: number;
}

/**
 * Where each `open` in `text` closes, in one pass: `closes[i]` is the index of the `close` that matches the `open` at `i`,
 * or -1 when `i` is not an `open` or never closes. A `close` with nothing open is ignored.
 */
function closeIndexes(text: string, open: string, close: string, meter: Meter): Int32Array {
    const closes = new Int32Array(text.length).fill(-1);
    const opened: number[] = [];

    meter.steps += text.length;

    for (let index = 0; index < text.length; index += 1) {
        const char = text.charAt(index);

        if (char === open) {
            opened.push(index);
        } else if (char === close) {
            const start = opened.pop();

            if (start !== undefined) {
                closes[start] = index;
            }
        }
    }

    return closes;
}

/** How a group's cleaned content joins the text before it. */
type Join =
    /** The text itself. */
    | 'root'
    /** Between its own brackets. */
    | 'wrapped'
    /** In place of the group, after the text before it loses its trailing space: `butter (, softened)`. */
    | 'afterComma'
    /** In place of the group. */
    | 'bare';

/** A stretch of the text being cleaned, from `index` to `hi`, and the output so far. */
interface Frame {
    readonly hi: number;
    readonly join: Join;
    index: number;
    out: string;
}

/** `frame`'s output, placed in its parent's. */
function joined(parent: Frame, child: Frame, open: string, close: string): void {
    if (child.join === 'wrapped') {
        parent.out += `${open}${child.out}${close}`;
    } else if (child.join === 'afterComma') {
        parent.out = `${parent.out.trimEnd()}${child.out}`;
    } else {
        parent.out += child.out;
    }
}

/** Whether `text[lo..hi)` opens with a whole round group that a comma follows: `(a), b`. */
function opensWithGroupAndComma(text: string, closes: Int32Array, lo: number, hi: number): boolean {
    const end = closes[lo] ?? -1;

    return text.charAt(lo) === '(' && end > lo && end + 1 < hi && text.charAt(end + 1) === ',';
}

/** The frame for the group opened at `start`, which closes at `end`: its doubled outer brackets peeled, and how it joins. */
function groupFrame(text: string, closes: Int32Array, start: number, end: number, open: string, meter: Meter): Frame {
    let lo = start + 1;
    let hi = end;

    while (text.charAt(lo) === open && closes[lo] === hi - 1) {
        meter.steps += 1;
        lo += 1;
        hi -= 1;
    }

    if (open === '(' && hi - lo >= 2 && text.startsWith(', ', lo)) {
        return { hi, join: 'afterComma', index: lo, out: '' };
    }

    return {
        hi,
        join: open === '(' && opensWithGroupAndComma(text, closes, lo, hi) ? 'bare' : 'wrapped',
        index: lo,
        out: '',
    };
}

function collapseKind(text: string, open: string, close: string, meter: Meter): string {
    const closes = closeIndexes(text, open, close, meter);
    const frames: Frame[] = [{ hi: text.length, join: 'root', index: 0, out: '' }];
    let result = '';

    for (let frame = frames.at(-1); frame !== undefined; frame = frames.at(-1)) {
        meter.steps += 1;

        if (frame.index >= frame.hi) {
            frames.pop();

            const parent = frames.at(-1);

            if (parent === undefined) {
                result = frame.out;
            } else {
                joined(parent, frame, open, close);
            }

            continue;
        }

        const end = text.charAt(frame.index) === open ? (closes[frame.index] ?? -1) : -1;

        if (end < 0) {
            frame.out += text.charAt(frame.index);
            frame.index += 1;
            continue;
        }

        frames.push(groupFrame(text, closes, frame.index, end, open, meter));
        frame.index = end + 1;
    }

    return result;
}

/**
 * {@link collapseBracketGroups}, with the steps it took: the count a test holds linear in place of a time budget.
 *
 * @param text - One line of text.
 * @returns The collapsed text, and the steps taken. Pure.
 */
export function collapseBracketGroupsCounted(text: string): { readonly text: string; readonly steps: number } {
    const meter: Meter = { steps: 0 };
    const collapsed = collapseKind(collapseKind(text, '(', ')', meter), '[', ']', meter);

    return { text: collapsed, steps: meter.steps };
}

/**
 * @param text - One line of text.
 * @returns `text` with each doubled bracket group made single. Linear in the text, whatever its nesting. Pure.
 */
export function collapseBracketGroups(text: string): string {
    return collapseBracketGroupsCounted(text).text;
}
