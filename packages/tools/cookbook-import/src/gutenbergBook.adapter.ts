/**
 * ADAPTER: a Project Gutenberg cookbook's plain text → titled prose blocks.
 *
 * DESIGN PATTERN: **Adapter** (ADR-0019 §1's own word for an import channel). It TRANSLATES one corpus's
 * layout into the shape the rest of the pipeline consumes, and — this is the contract, not a stylistic
 * preference — it **adds no behaviour**. It does not title-case, does not extract ingredients, does not
 * decide which blocks are worth importing, and does not drop a heading it finds unpromising. The moment it
 * starts making those judgements it has stopped being an adapter and become an unnamed service, and the
 * "why was this recipe skipped?" question loses its single answer.
 *
 * ⛔ THE CORPUS IS FETCHED OUT OF BAND, BY AN OPERATOR, AND THIS MODULE NEVER FETCHES ANYTHING. Project
 * Gutenberg's robots.txt permits `/cache/epub/…` while its Terms state the site "is intended for human
 * users only" and that automated access "will result in a temporary or permanent block of your IP address"
 * (verified 2026-08-19). robots.txt compliance is not terms compliance. The blast radius of a runtime fetch
 * is that the egress identity is SHARED and stage-level — Fargate tasks egress through the IGW on their
 * assigned public IPs, VPC-attached Lambdas through the single `t4g.nano` NAT instance (ADR-0004), and CI
 * through GitHub's shared runner pools — so a block earned by this tool is not served to this tool alone.
 * See ADR-0023 and `README.md`.
 *
 * ## The three layouts this handles, and why each one is here
 *
 * Every rule below exists because a real book in the corpus breaks without it:
 *
 *  - **#12350** (_The International Jewish Cook Book_) — bare ALL-CAPS headings, quantities spelled out.
 *  - **#12327** (_The Jewish Manual_) — headings carry a TRAILING PERIOD (`CURRIED VEAL.`).
 *  - **#55555** (_The Golden Rule Cook Book_) — same headings, but quantities are NUMERALS (`1 tablespoon`).
 *
 * Bodies are hard-wrapped at ~72 columns, frequently mid-phrase (`one-half\ntablespoon of flour`). Joining
 * a paragraph's lines is therefore load-bearing: a quantity phrase broken by a newline is invisible to
 * every downstream scanner.
 */

/** One titled block of prose, exactly as the book printed it. */
export interface CookbookBlock {
    /** The heading text, `*`-wrapping and any trailing period removed. Still as-printed (ALL CAPS). */
    readonly title: string;
    /** The body paragraphs beneath it, each un-wrapped to a single line. Empty when the heading had none. */
    readonly paragraphs: readonly string[];
}

/**
 * A heading line.
 *
 * Upper-case letters, digits and the punctuation these books actually use in titles. It deliberately does
 * NOT admit lower-case, which is what separates `CURRIED VEAL.` from `*For Fleischig Soup.*--This soup may
 * be made with fat…` — an inline emphasis run that opens a body paragraph and would otherwise be read as a
 * heading, stealing the rest of the recipe.
 */
const HEADING = /^\*?[A-Z][A-Z0-9 ,.'()\-&;:/"]*\*?$/;

/** Shortest and longest heading accepted. Bounds a stray line of shouted prose from becoming a recipe. */
const MIN_HEADING_LENGTH = 3;
const MAX_HEADING_LENGTH = 70;

/**
 * Whether a block of text is a heading rather than a body paragraph.
 *
 * @param text - One blank-line-delimited block.
 * @returns `true` when it is a single ALL-CAPS line within the length bounds. Pure.
 */
function isHeading(text: string): boolean {
    return (
        !text.includes('\n') &&
        text.length >= MIN_HEADING_LENGTH &&
        text.length <= MAX_HEADING_LENGTH &&
        HEADING.test(text) &&
        // At least three consecutive capitals, so a line like `A.` or `II.` is not a recipe.
        /[A-Z]{3}/.test(text)
    );
}

/**
 * Normalize a heading to the name the book means: drop `*` wrapping and a single trailing period.
 *
 * The trailing period is typography (#12327 prints `CURRIED VEAL.`), not part of the name — keeping it
 * would put a stray full stop in every imported title from that book.
 *
 * @param heading - The raw heading line.
 * @returns The cleaned title. Pure.
 */
function cleanHeading(heading: string): string {
    return heading.replace(/^\*+/, '').replace(/\*+$/, '').trim().replace(/\.$/, '').trim();
}

/**
 * Drop Project Gutenberg's legal header and licence footer, keeping the book itself.
 *
 * ⚠️ Returns the input UNCHANGED when the markers are absent, rather than returning nothing. A silent
 * empty return would present downstream as "this book contains no recipes" — a zero-yield run that looks
 * like a parser bug and sends the reader to the wrong file.
 *
 * @param plainText - The whole `.txt` as downloaded.
 * @returns The text between the START and END markers, or the input when they are not both present. Pure.
 */
export function stripGutenbergBoilerplate(plainText: string): string {
    const normalized = plainText.replace(/\r\n/g, '\n');
    const startMarker = normalized.indexOf('*** START OF THE PROJECT GUTENBERG');
    const endMarker = normalized.indexOf('*** END OF');

    if (startMarker < 0 || endMarker < 0 || endMarker <= startMarker) {
        return normalized;
    }

    const bodyStart = normalized.indexOf('\n', startMarker);

    return normalized.slice(bodyStart < 0 ? startMarker : bodyStart + 1, endMarker);
}

/**
 * Segment a cookbook's plain text into titled prose blocks.
 *
 * Text appearing BEFORE the first heading is discarded (front matter — the title page, the preface); every
 * paragraph after a heading belongs to that heading until the next one. A heading with nothing under it
 * yields an EMPTY block rather than no block, so the caller can count and report it as a skip instead of
 * losing it silently.
 *
 * @param plainText - The whole `.txt` as downloaded (boilerplate is stripped here).
 * @returns One block per heading, in book order. Pure.
 */
export function segmentCookbook(plainText: string): readonly CookbookBlock[] {
    const body = stripGutenbergBoilerplate(plainText);
    const chunks = body
        .split(/\n\s*\n+/)
        .map((chunk) => chunk.trim())
        .filter((chunk) => chunk.length > 0);

    const blocks: { title: string; paragraphs: string[] }[] = [];

    for (const chunk of chunks) {
        if (isHeading(chunk)) {
            blocks.push({ title: cleanHeading(chunk), paragraphs: [] });
            continue;
        }

        // Un-wrap: the source hard-wraps mid-phrase, and a quantity broken by a newline is unreadable.
        blocks.at(-1)?.paragraphs.push(chunk.replace(/\s*\n\s*/g, ' ').trim());
    }

    return blocks;
}
