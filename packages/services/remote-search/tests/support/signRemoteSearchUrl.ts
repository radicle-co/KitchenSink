/**
 * Sign a search-service URL the way food-service signs it (`food-service/src/sources/remote/SearchServiceRemoteSearch.ts`):
 * a canned policy with a SHA-256 signature, through `@aws-sdk/cloudfront-signer`. The deployed tier and the k6 URL
 * minter both sign through this, so neither proves a path food does not use.
 *
 * @module
 */
import { getSignedUrl } from '@aws-sdk/cloudfront-signer';

import type { SigningKey } from './readSigningKey.js';

/**
 * A signed copy of `url`. Pure.
 *
 * @param key - The base stage's key-pair id and private key.
 * @param url - The URL to sign, with its request parameters.
 * @param dateLessThan - When the signature stops holding, ISO 8601.
 * @returns The signed URL.
 */
export function signRemoteSearchUrl(key: SigningKey, url: URL, dateLessThan: string): string {
    return getSignedUrl({
        url: url.href,
        keyPairId: key.keyPairId,
        privateKey: key.privateKey,
        dateLessThan,
        algorithm: 'SHA256',
    });
}
