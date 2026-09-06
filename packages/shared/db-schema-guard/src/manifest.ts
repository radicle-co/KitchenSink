/**
 * The migration manifest — a canonical, reproducible rendering of "which migration set is this".
 *
 * ## Why the format is exactly `sha256sum`'s
 *
 * The manifest is computed TWICE by two independent implementations: here, in the bundle that ships with a
 * deploy, and in `.github/scripts/run-migrations.sh` from the working tree. Two implementations are the
 * point — a single shared helper can be wrong identically on both sides and still agree, whereas two
 * cannot, because sha256 has exactly one right answer.
 *
 * That only works if the rendering is one both can produce without coordination, so it is byte-for-byte
 * GNU `sha256sum`'s: `<64 lowercase hex><space><space><name><newline>`, ordered by name under C collation.
 * The CI half is then literally `sha256sum *.sql | sha256sum`.
 *
 * ⚠️ The two spaces are load-bearing. `sha256sum` prints the digest, a space, and a MODE INDICATOR — a
 * space for text mode, `*` for binary. Rendering one space here makes the two implementations disagree on
 * every run, which presents as a stale runner on a deploy that is perfectly healthy.
 */
import { createHash } from 'node:crypto';

/** A well-formed manifest digest: 64 lowercase hex characters, anchored. */
const MANIFEST_SHA_PATTERN = /^[0-9a-f]{64}$/u;

/** One migration's contribution to the manifest. */
export interface ManifestEntry {
    /** The `.sql` filename, with its extension. */
    readonly name: string;
    /** The sha256 of that file's bytes, lowercase hex. */
    readonly sha256: string;
}

/**
 * Is this a well-formed manifest digest?
 *
 * @param value - The candidate digest.
 * @returns `true` for 64 lowercase hex characters and nothing else.
 */
export function isManifestSha(value: string): boolean {
    return MANIFEST_SHA_PATTERN.test(value);
}

/**
 * The sha256 of a byte string, lowercase hex.
 *
 * @param content - The bytes to digest.
 * @returns The digest as 64 lowercase hex characters.
 */
export function sha256Hex(content: Buffer | string): string {
    return createHash('sha256').update(content).digest('hex');
}

/**
 * Render entries as manifest text, ordered by name.
 *
 * Sorting HERE rather than trusting the caller is deliberate: the entries arrive from `readdir`, whose
 * order is filesystem-defined and differs between a developer's machine and a Lambda's read-only bundle.
 * An unsorted rendering would digest differently on the two sides for no reason at all.
 *
 * @param entries - The migrations and their digests, in any order.
 * @returns The canonical manifest text.
 */
export function formatManifest(entries: readonly ManifestEntry[]): string {
    return [...entries]
        .sort(byName)
        .map((entry) => `${entry.sha256}  ${entry.name}\n`)
        .join('');
}

/**
 * Order two entries by name under C collation — a plain code-unit comparison, NOT `localeCompare`, whose
 * answer depends on the runner's locale and would put the two implementations at odds on a machine whose
 * collation differs from CI's.
 *
 * @param left - The first entry.
 * @param right - The second entry.
 * @returns A negative, zero, or positive ordering value.
 */
function byName(left: ManifestEntry, right: ManifestEntry): number {
    if (left.name < right.name) {
        return -1;
    }

    if (left.name > right.name) {
        return 1;
    }

    return 0;
}

/**
 * The digest of a rendered manifest — the single value a caller passes to a runner to say which set it
 * expects.
 *
 * @param text - Manifest text as produced by {@link formatManifest}.
 * @returns The digest as 64 lowercase hex characters.
 */
export function digestManifest(text: string): string {
    return sha256Hex(text);
}
