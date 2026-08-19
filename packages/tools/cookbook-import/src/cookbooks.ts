/**
 * The corpus REGISTRY — the public-domain cookbooks this tool imports from.
 *
 * DESIGN PATTERN: **Lookup table** (data, not mechanism). Frozen, exhaustive, and the ONE place a book's
 * identity, its licence evidence and the attribution string a reader will see are written down together.
 *
 * ## ⛔ The files are NOT in this repository, and are NOT fetched at runtime
 *
 * An operator downloads them once, by hand, and passes the path (`--file`). See `README.md`. The reason is
 * not repository size — it is that Project Gutenberg's Terms state the site "is intended for human users
 * only" and that automated access "will result in a temporary or permanent block of your IP address",
 * while its `robots.txt` only disallows `/ebooks/search` (both verified 2026-08-19). **robots.txt
 * compliance is not terms-of-use compliance.** A service-side fetch would put a whole stage's shared
 * `t4g.nano` NAT egress IP (ADR-0004) behind that block. See ADR-0023.
 *
 * ## Public-domain evidence
 *
 * Each entry was verified by reading the file's own header, which must carry Project Gutenberg's
 * unrestricted-use sentence — "This eBook is for the use of anyone anywhere in the United States and most
 * other parts of the world at no cost and with almost no restrictions whatsoever" — and NOT the
 * "copyrighted Project Gutenberg eBook" variant. {@link PUBLIC_DOMAIN_HEADER} is that sentence, and
 * {@link assertPublicDomain} re-checks it against the actual bytes at import time, so the claim is
 * verified per run rather than trusted from this comment.
 *
 * ## ⚠️ The attribution string is a ONE-WAY DOOR
 *
 * It is written into `recipes.source_attribution` on public rows and RENDERED on the recipe detail view.
 * Changing the format afterwards is a data migration over public content. The chosen form names the
 * ORIGINAL work and author (the public-domain thing) and credits Project Gutenberg as the transcription
 * source, which is where the copy came from. It does not reproduce the PG licence header, and it does not
 * use the Project Gutenberg trademark to describe the recipe itself. **Flagged for owner/legal review.**
 */

/** Project Gutenberg's unrestricted-use sentence — the evidence a given file is public domain in the US. */
export const PUBLIC_DOMAIN_HEADER = 'This eBook is for the use of anyone anywhere in the United States and';

/** One public-domain cookbook. */
export interface Cookbook {
    /** Project Gutenberg ebook number. */
    readonly ebookId: number;
    /** The work's title, as its own title page gives it. */
    readonly title: string;
    /** The author, as the file's `Author:` header gives it. */
    readonly author: string;
    /** The plain-text URL the operator downloads from — persisted verbatim as `sourceUrl`. */
    readonly sourceUrl: string;
    /** The human-readable credit persisted as `sourceAttribution` and rendered to readers. */
    readonly attribution: string;
}

/**
 * Build a book entry, deriving the URL and the attribution from the identity so the three cannot disagree.
 *
 * Deriving rather than restating is the point: a hand-typed `sourceUrl` whose ebook id does not match the
 * entry's is a mislabelled provenance on a public recipe, which is exactly the failure attribution exists
 * to prevent, and it is invisible in review.
 *
 * @param ebookId - Project Gutenberg ebook number.
 * @param title - The work's title.
 * @param author - The work's author.
 * @returns The frozen entry. Pure.
 */
function cookbook(ebookId: number, title: string, author: string): Cookbook {
    return Object.freeze({
        ebookId,
        title,
        author,
        sourceUrl: `https://www.gutenberg.org/cache/epub/${ebookId}/pg${ebookId}.txt`,
        attribution: `${title} by ${author} (Project Gutenberg eBook #${ebookId}, public domain)`,
    });
}

/**
 * The registered corpus, keyed by the `--book` argument.
 *
 * All three are ALL-CAPS-heading, prose-bodied domestic cookery — the shape this tool's adapter reads.
 * They differ in the two ways that matter, deliberately, so the parser is exercised rather than tuned to
 * one book: #12327 prints a trailing period on its headings, and #55555 writes quantities as NUMERALS
 * where the other two spell them out.
 */
export const COOKBOOKS: Readonly<Record<string, Cookbook>> = Object.freeze({
    'international-jewish': cookbook(12350, 'The International Jewish Cook Book', 'Florence Kreisler Greenbaum'),
    'jewish-manual': cookbook(12327, 'The Jewish Manual', 'Lady Judith Cohen Montefiore'),
    'golden-rule': cookbook(55555, 'The Golden Rule Cook Book', 'M. R. L. Sharpe'),
});

/** The `--book` keys this tool accepts. */
export type CookbookKey = keyof typeof COOKBOOKS;

/**
 * Fail loudly unless the supplied text carries Project Gutenberg's unrestricted-use header.
 *
 * ⚠️ This runs on the ACTUAL BYTES every run, rather than trusting the registry. The registry records a
 * claim made by a human reading a file once; this checks the file in front of us. A copyrighted Project
 * Gutenberg ebook (they exist, and they carry a different header) would otherwise be imported and
 * published as `imported_public` — a licence violation asserted in a user-visible attribution line.
 *
 * @param plainText - The downloaded book.
 * @param book - The registry entry it is claimed to be.
 * @throws {Error} When the header is absent — the run aborts rather than importing anything.
 */
export function assertPublicDomain(plainText: string, book: Cookbook): void {
    if (!plainText.includes(PUBLIC_DOMAIN_HEADER)) {
        throw new Error(
            `cookbook-import: the file supplied for "${book.title}" (#${book.ebookId}) does not carry Project ` +
                `Gutenberg's public-domain header. Refusing to import it — a copyrighted ebook must not be ` +
                `published as imported_public.`,
        );
    }
}
