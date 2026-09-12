/**
 * The curator grant is read from the TOKEN, never from the credential file beside it.
 *
 * `mintLinkageCredentials.ts` writes the roster's declared scopes into the file, and the lease checks only the
 * test-principal marker and the external id. So between a roster change and the owner's `poolAdmin --apply`, the
 * file says the grant is there while the signed token lacks it, and every create would be refused `403` for a
 * reason that reads like a policy result. The token's own signed `public_metadata.scopes` is what the service
 * reads (ADR-0023), so it is what this check reads.
 */
import { CURATOR_IMPORT_SCOPE } from '@kitchensink/schema-recipe';
import { describe, expect, it } from 'vitest';

import { curatorTokenOf } from '../curatorCredential.js';

/**
 * An unsigned token with `claims` as its payload. The check decodes, it never verifies: the service verifies.
 *
 * @param claims - The payload.
 * @returns The compact token.
 */
function tokenWith(claims: Readonly<Record<string, unknown>>): string {
    const part = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');

    return `${part({ alg: 'RS256', typ: 'JWT' })}.${part(claims)}.signature`;
}

/**
 * A credential file as the mint writes it.
 *
 * @param token - Its token.
 * @param scopes - What the file claims, which the check must ignore.
 * @returns The file's text.
 */
function fileWith(token: string, scopes: readonly string[] = [CURATOR_IMPORT_SCOPE]): string {
    return JSON.stringify({ token, azp: 'https://pr-91.sandbox.commise.app', sub: 'user_1', externalId: 'u1', scopes });
}

describe('curatorTokenOf', () => {
    it('returns the token when its signed metadata carries the curator grant', () => {
        const token = tokenWith({
            sub: 'user_1',
            public_metadata: { scopes: ['recipes:write', CURATOR_IMPORT_SCOPE] },
        });

        expect(curatorTokenOf(fileWith(token))).toBe(token);
    });

    it.each<[string, Readonly<Record<string, unknown>>]>([
        ['carries other grants only', { public_metadata: { scopes: ['recipes:write', 'foods:read'] } }],
        ['carries an empty grant list', { public_metadata: { scopes: [] } }],
        ['carries no public metadata', { sub: 'user_1' }],
        ['carries metadata of the wrong shape', { public_metadata: { scopes: CURATOR_IMPORT_SCOPE } }],
    ])('refuses a token that %s, even though the file claims the grant', (_case, claims) => {
        expect(() => curatorTokenOf(fileWith(tokenWith(claims)))).toThrow(/poolAdmin --apply/u);
    });

    it('refuses a token that is not a JWT at all', () => {
        expect(() => curatorTokenOf(fileWith('not-a-jwt'))).toThrow(/poolAdmin --apply/u);
    });

    it.each([
        ['not JSON', 'token=abc'],
        ['JSON with no token', JSON.stringify({ scopes: [CURATOR_IMPORT_SCOPE] })],
        ['JSON with an empty token', JSON.stringify({ token: '' })],
    ])('refuses a credential file that is %s', (_case, text) => {
        expect(() => curatorTokenOf(text)).toThrow(/credential file/u);
    });
});
