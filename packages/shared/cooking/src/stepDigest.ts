/**
 * Step digests: a change detector for one step's text, so a saved position follows its step when a recipe is edited
 * (plan 0003 KTD7, S57). Pure, synchronous, no I/O.
 *
 * The hash is FNV-1a 32 over the UTF-8 bytes of the normalized text, not a hash library: it has published reference
 * vectors, runs on Hermes and in browsers, and only has to tell one recipe's few dozen steps apart. It is not a
 * security control. The only lockfile candidate (`imurmurhash`) is a transitive dev dependency, which does not justify a
 * runtime dependency of this shared library for a five-line published algorithm.
 */

/** The digest format version, the `s1` prefix of every digest. */
export const STEP_DIGEST_VERSION = 1;

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const encoder = new TextEncoder();

/** A saved position: the step's index and the digest of its text when it was saved. */
export interface StepRef {
    readonly index: number;
    readonly digest: string;
}

/**
 * @param text - A step's text.
 * @returns NFC, every run of Unicode whitespace collapsed to one space, trimmed. Nothing else is folded: case, digits
 * and punctuation count ("2 cups" and "3 cups" differ).
 */
export function normalizeStepText(text: string): string {
    return text.normalize('NFC').replace(/\s+/gu, ' ').trim();
}

/**
 * @param text - A step's text.
 * @returns `s1:` and 8 lowercase hex chars of FNV-1a 32 over the UTF-8 bytes of the normalized text.
 */
export function stepDigest(text: string): string {
    let hash = FNV_OFFSET;

    for (const byte of encoder.encode(normalizeStepText(text))) {
        hash = Math.imul(hash ^ byte, FNV_PRIME) >>> 0;
    }

    return `s${STEP_DIGEST_VERSION}:${hash.toString(16).padStart(8, '0')}`;
}

function matchesOf(saved: StepRef, stepDigests: readonly string[]): number[] {
    const found: number[] = [];

    stepDigests.forEach((digest, index) => {
        if (digest === saved.digest) {
            found.push(index);
        }
    });

    return found;
}

/**
 * @param saved - The saved position.
 * @param stepDigests - The digest of each current step, in order.
 * @returns The one step whose digest matches. None or several give the saved index clamped to the last step. With no
 * steps, `undefined`, so the caller keeps its stored index.
 */
export function matchStep(saved: StepRef, stepDigests: readonly string[]): number | undefined {
    if (stepDigests.length === 0) {
        return undefined;
    }

    const found = matchesOf(saved, stepDigests);

    return found.length === 1 ? found[0] : Math.min(Math.max(saved.index, 0), stepDigests.length - 1);
}

/**
 * @param saved - A mark or line tick.
 * @param stepDigests - The digest of each current step, in order.
 * @returns The single matching step, else `undefined`: a mark with no single match is dropped, with no index fallback.
 */
export function matchStepStrict(saved: StepRef, stepDigests: readonly string[]): number | undefined {
    const found = matchesOf(saved, stepDigests);

    return found.length === 1 ? found[0] : undefined;
}
