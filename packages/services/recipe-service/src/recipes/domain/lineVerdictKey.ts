/**
 * The key a verdict about a SAVED recipe line lives under (ADR-0072 §6).
 *
 * DESIGN PATTERN: **Specification**, pure. One authority for "which verdict is this line's": `verifiedLineIdentity` says
 * what a verdict is ABOUT (the source text, the bound food, the measure) and `verificationKey` hashes it. The recipe detail
 * reads a line's verdict with this, and the bulk import stores it beside the saved line, so the flagged list and the import
 * view's `version` can read verdicts in SQL without re-deriving a hash for every line on every poll. A second copy of the
 * composition would drift, and the import would look a verdict up under a key the worker never wrote.
 */
import { verificationKey, type HexDigest } from '@kitchensink/recipe-core/resolution/verification-key';

import { verifiedLineIdentity, type JudgeableLine } from './lineVerification.js';

/**
 * The verdict key of one saved line.
 *
 * @param line - The line's own columns: its source text, its measure and what the source printed.
 * @param foodRefId - The id of the food the line is bound to (a root's or a variant's), if any.
 * @param digest - The hex digest (`sha256Hex`).
 * @returns The key, or `undefined` when no verdict about the line can exist: no source text to check our parse against, or no
 *   food to judge. Pure, given a pure digest.
 */
export function verdictKeyOfLine(
    line: JudgeableLine,
    foodRefId: string | undefined,
    digest: HexDigest,
): string | undefined {
    const identity = verifiedLineIdentity(line, foodRefId);

    return identity === undefined ? undefined : verificationKey(identity, digest);
}
