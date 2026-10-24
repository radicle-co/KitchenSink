/**
 * The test tiers' URL signer signs exactly as food-service does (`SearchServiceRemoteSearch.ts`): a canned policy with a
 * SHA-256 signature, so a deployed run or a k6 run proves the path food actually uses.
 */
import { generateKeyPairSync } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { signRemoteSearchUrl } from '../../support/signRemoteSearchUrl.js';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const KEY = { keyPairId: 'K2EXAMPLE', privateKey: privateKey.export({ type: 'pkcs1', format: 'pem' }).toString() };

describe('signRemoteSearchUrl', () => {
    it('signs with SHA-256, the key-pair id and the expiry, keeping the request parameters', () => {
        const signed = new URL(
            signRemoteSearchUrl(
                KEY,
                new URL('https://remote-search-pr-1.commise.app/v1/usda/3/search?q=kale'),
                new Date(Date.now() + 60_000).toISOString(),
            ),
        );

        expect(signed.searchParams.get('Hash-Algorithm')).toBe('SHA256');
        expect(signed.searchParams.get('Key-Pair-Id')).toBe('K2EXAMPLE');
        expect(signed.searchParams.get('Signature')).not.toBeNull();
        expect(signed.searchParams.get('q')).toBe('kale');
        expect(Number(signed.searchParams.get('Expires'))).toBeGreaterThan(Date.now() / 1000);
    });
});
