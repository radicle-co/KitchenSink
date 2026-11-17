/**
 * THE PRODUCTION KEYED HASH of a shingle: the one place the HMAC-to-int64 step is written.
 *
 * DESIGN PATTERN: **Port adapter.** `wordShingles.ts` takes a {@link KeyedHash} and stays free of crypto; this is the
 * adapter every server consumer injects, so all of them store identical values for identical text. The value is
 * HMAC-SHA256 over the UTF-8 bytes of the NFC shingle, and its first 8 bytes read big-endian as a SIGNED 64-bit
 * integer (the `bigint[]` column type).
 *
 * KEY ENCODING: a string key is used as its UTF-8 bytes, exactly as the keyring secret holds it (a generated
 * alphanumeric string, not base64). A `Uint8Array` key is used as raw bytes. An empty key is refused.
 *
 * SERVER ONLY. This module imports `node:crypto`, which the web and mobile bundles do not have. Keeping it
 * out of the apps is enforced by `nodeKeyedHashServerOnly.test.ts` in repoGuards: only services and recipe-core's own
 * tests may import it, so neither the barrel nor another recipe-core module can.
 */
import { createHmac } from 'node:crypto';

import { FingerprintKeyringError, type FingerprintKeyring } from './fingerprintKeyring.js';
import type { KeyedHash, KeyedHasher } from './wordShingles.js';

/**
 * Build the keyed hash for one key.
 *
 * @param key - The keyring key: a string (UTF-8 bytes) or raw bytes.
 * @returns A {@link KeyedHash}. Pure given the key.
 * @throws {RangeError} when the key is empty.
 */
export function keyedShingleHash(key: string | Uint8Array): KeyedHash {
    if (key.length === 0) {
        throw new RangeError('The fingerprint key must not be empty.');
    }

    return (shingle) => createHmac('sha256', key).update(shingle.normalize('NFC'), 'utf8').digest().readBigInt64BE(0);
}

/**
 * The hasher for one key version of a keyring, with the version attached, so a fingerprint always records the key it
 * was made under.
 *
 * @param ring - The parsed keyring.
 * @param version - The key version to use.
 * @returns The version and its {@link KeyedHash}. Pure given the ring.
 * @throws {FingerprintKeyringError} when the ring holds no key for `version`.
 */
export function hasherFor(ring: FingerprintKeyring, version: number): KeyedHasher {
    const key = ring.keys.get(version);

    if (key === undefined) {
        throw new FingerprintKeyringError(`Fingerprint keyring has no key for key version ${version}.`);
    }

    return { keyVersion: version, hash: keyedShingleHash(key) };
}
