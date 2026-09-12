/**
 * The SHA-256 hex digest this service supplies to `@kitchensink/recipe-core`'s injected `HexDigest` port.
 *
 * ⛔ IT IS A PORT ADAPTER, NOT A UTILITY, and the indirection is deliberate. `verificationKey()` keeps the
 * canonical serialization — what goes into the digest and in what order — inside `recipe-core`, which the
 * WEB and MOBILE bundles import through its barrel. Pulling `node:crypto` in there for one server-side
 * module would put a Node dependency on both apps' bundles, so the digest is injected instead and each
 * server-side caller supplies this one-line adapter.
 *
 * ⚠️ `node:crypto`, never a hand-rolled hash and never a third-party one: the digest must be byte-identical
 * to the one `recipe-workers` takes, and the standard library is the only implementation both can be sure
 * they share.
 */
import { createHash } from 'node:crypto';

/**
 * Hex SHA-256 of a string.
 *
 * @param input - The exact preimage to hash.
 * @returns The lower-case hex digest. Pure (deterministic, no I/O, no state).
 */
export function sha256Hex(input: string): string {
    return createHash('sha256').update(input, 'utf8').digest('hex');
}
