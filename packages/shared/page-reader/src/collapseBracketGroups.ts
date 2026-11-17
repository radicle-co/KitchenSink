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
 * closes ({@link closeIndexes}), and an explicit stack of frames (not the call stack) walks the groups, writing to one
 * shared output, so a line of 100,000 nested or unclosed brackets costs a scan and cannot overflow the stack. The reader also refuses a line past
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

/** A stretch of the text being cleaned, from `index` to `hi`, and where its output starts in the shared output. */
interface Frame {
    readonly hi: number;
    readonly join: Join;
    /** The length of the output when the frame began: a trim never reaches back past it. */
    readonly outStart: number;
    index: number;
}

/**
 * Drop the whitespace at the end of `out`, back to `floor`. Each character is pushed once and so popped at most once: the
 * trims of a whole line cost no more than its length, however many groups ask for one.
 */
function trimTail(out: string[], floor: number, meter: Meter): void {
    while (out.length > floor && (out.at(-1) ?? '').trim() === '') {
        meter.steps += 1;
        out.pop();
    }
}

/** Whether `text[lo..hi)` opens with a whole round group that a comma follows: `(a), b`. */
function opensWithGroupAndComma(text: string, closes: Int32Array, lo: number, hi: number): boolean {
    const end = closes[lo] ?? -1;

    return text.charAt(lo) === '(' && end > lo && end + 1 < hi && text.charAt(end + 1) === ',';
}

/** The frame for the group opened at `start`, which closes at `end`: its doubled outer brackets peeled, and how it joins. */
function groupFrame(
    text: string,
    closes: Int32Array,
    start: number,
    end: number,
    open: string,
    { meter, outStart }: { readonly meter: Meter; readonly outStart: number },
): Frame {
    let lo = start + 1;
    let hi = end;

    while (text.charAt(lo) === open && closes[lo] === hi - 1) {
        meter.steps += 1;
        lo += 1;
        hi -= 1;
    }

    if (open === '(' && hi - lo >= 2 && text.startsWith(', ', lo)) {
        return { hi, join: 'afterComma', index: lo, outStart };
    }

    return {
        hi,
        join: open === '(' && opensWithGroupAndComma(text, closes, lo, hi) ? 'bare' : 'wrapped',
        index: lo,
        outStart,
    };
}

/**
 * One bracket kind's pass. The output is ONE array of characters shared by every frame, in text order: a wrapped group
 * writes its brackets around its content as it opens and closes, and a group after a comma trims the array's tail. No
 * frame's output is copied into its parent's, so nesting costs nothing extra.
 */
function collapseKind(text: string, open: string, close: string, meter: Meter): string {
    const closes = closeIndexes(text, open, close, meter);
    const out: string[] = [];
    const frames: Frame[] = [{ hi: text.length, join: 'root', index: 0, outStart: 0 }];

    for (let frame = frames.at(-1); frame !== undefined; frame = frames.at(-1)) {
        meter.steps += 1;

        if (frame.index >= frame.hi) {
            frames.pop();

            if (frame.join === 'wrapped') {
                out.push(close);
            }

            continue;
        }

        const end = text.charAt(frame.index) === open ? (closes[frame.index] ?? -1) : -1;

        if (end < 0) {
            out.push(text.charAt(frame.index));
            frame.index += 1;
            continue;
        }

        const child = groupFrame(text, closes, frame.index, end, open, { meter, outStart: out.length });

        if (child.join === 'wrapped') {
            out.push(open);
        } else if (child.join === 'afterComma') {
            trimTail(out, frame.outStart, meter);
        }

        frames.push(child);
        frame.index = end + 1;
    }

    return out.join('');
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
