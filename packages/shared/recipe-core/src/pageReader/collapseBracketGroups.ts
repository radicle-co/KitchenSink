/**
 * Clean the bracket groups a page's own markup writes badly: `((softened))` becomes `(softened)`.
 *
 * Two more cleanups, for ROUND groups only, each of a shape a template writes when it fills a note in twice:
 * - a group whose content opens with a comma is the rest of the line: `butter (, softened)` becomes `butter, softened`;
 * - a group whose content opens with a whole group and then a comma loses its outer brackets: `((or a pinch), plus a few
 *   sprigs)` becomes `(or a pinch), plus a few sprigs`.
 *
 * The reader cleans the text here; the gate never rewrites. Round and square brackets are read apart, by a depth-counting
 * character scan (no regular expression runs over page text). Every occurrence is collapsed, an unbalanced bracket is
 * left alone, and the result is a fixed point.
 */

/** Where the group opened at `start` closes, or -1 when it never does. */
function groupEnd(text: string, start: number, open: string, close: string): number {
    let depth = 0;

    for (let index = start; index < text.length; index += 1) {
        const char = text.charAt(index);

        if (char === open) {
            depth += 1;
        } else if (char === close) {
            depth -= 1;

            if (depth === 0) {
                return index;
            }
        }
    }

    return -1;
}

/** Whether `inner` opens with a whole round group that a comma follows: `(a), b`. */
function opensWithGroupAndComma(inner: string): boolean {
    if (inner.charAt(0) !== '(') {
        return false;
    }

    const end = groupEnd(inner, 0, '(', ')');

    return end > 0 && inner.charAt(end + 1) === ',';
}

function collapseKind(text: string, open: string, close: string): string {
    let out = '';
    let index = 0;

    while (index < text.length) {
        const end = text.charAt(index) === open ? groupEnd(text, index, open, close) : -1;

        if (end < 0) {
            out += text.charAt(index);
            index += 1;
            continue;
        }

        let inner = text.slice(index + 1, end);

        while (inner.charAt(0) === open && groupEnd(inner, 0, open, close) === inner.length - 1) {
            inner = inner.slice(1, -1);
        }

        if (open === '(' && inner.startsWith(', ')) {
            out = `${out.trimEnd()}${collapseKind(inner, open, close)}`;
        } else if (open === '(' && opensWithGroupAndComma(inner)) {
            out += collapseKind(inner, open, close);
        } else {
            out += `${open}${collapseKind(inner, open, close)}${close}`;
        }

        index = end + 1;
    }

    return out;
}

/**
 * @param text - One line of text.
 * @returns `text` with each doubled bracket group made single. Pure.
 */
export function collapseBracketGroups(text: string): string {
    return collapseKind(collapseKind(text, '(', ')'), '[', ']');
}
