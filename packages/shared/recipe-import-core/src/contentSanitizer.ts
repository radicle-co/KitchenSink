import { decodeHTML } from 'entities';
import sanitizeHtml from 'sanitize-html';

/**
 * Strip every tag and attribute. Frozen, because a per-call option object is a per-call opportunity to
 * loosen the policy, and MOD-021's placement argument (one chokepoint, not one call per channel) applies
 * to the configuration just as much as to the call site.
 */
const STRIP_EVERYTHING: sanitizeHtml.IOptions = Object.freeze({
    allowedTags: [],
    allowedAttributes: {},
});

/**
 * Decode passes before giving up.
 *
 * Decoding is monotonically non-expanding, so the loop converges; the cap only bounds a pathological
 * input. Eight is far past the two passes a double-encoded payload needs.
 */
const MAX_DECODE_PASSES = 8;

/** Unwraps `&amp;lt;script&amp;gt;` all the way down to `<script>` BEFORE anything strips tags. */
function decodeToFixedPoint(value: string): string {
    let current = value;

    for (let pass = 0; pass < MAX_DECODE_PASSES; pass += 1) {
        const next = decodeHTML(current);

        if (next === current) {
            return current;
        }

        current = next;
    }

    return current;
}

/**
 * Reduce an extracted text field to inert plain text (MOD-021, HAZ-029).
 *
 * DESIGN PATTERN: Adapter over `sanitize-html`, with a frozen Policy object.
 *
 * ⛔ THE ORDER IS THE CONTROL, and the obvious order is the vulnerability. `sanitize-html` RE-ESCAPES its
 * own output, so the intuitive `decode(sanitize(x))` hands back markup it appeared to remove: measured
 * 2026-08-19, `decode(sanitize('&amp;lt;script&amp;gt;alert(1)&amp;lt;/script&amp;gt;'))` returns
 * `'&lt;script&gt;alert(1)&lt;/script&gt;'` — one decode short of live markup, from a payload that was
 * merely double-encoded on the way in. The order here is therefore:
 *
 *   1. decode to a FIXED POINT, so no encoded markup can still be hiding as data;
 *   2. strip all tags and attributes;
 *   3. decode EXACTLY ONCE more, undoing only the sanitizer's own re-escaping.
 *
 * Step 3 cannot resurrect anything, because step 2 ran on fully-decoded text. A legitimate `<` survives
 * as text (`"heat to < 200 degrees"`); escaping it for a given sink is that sink's job, not this one's.
 *
 * Pure. Never throws.
 *
 * @param value - One extracted text field, from any import channel, before any parsing.
 * @returns The same field as plain text, carrying no markup.
 */
export function sanitizeToPlainText(value: string): string {
    return decodeHTML(sanitizeHtml(decodeToFixedPoint(value), STRIP_EVERYTHING));
}
