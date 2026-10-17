/**
 * The curator credential the deployed cookbook import suite sends, admitted only when its TOKEN carries the grant.
 *
 * The file `mintLinkageCredentials.ts` writes states the roster's declared scopes, not the token's, so it says the
 * grant is there until the owner's `poolAdmin --apply` actually puts it there. The service reads the grant from the
 * token's signed `public_metadata` (ADR-0023), and so does this check. It decodes and never verifies: verifying is
 * the service's job, and the suite's assertions are what prove it did.
 *
 * @pattern Parse, don't validate — the file and the token's claims are each parsed with zod where they enter
 */
import { decodeClaims } from '@kitchensink/e2e-fixtures';
import { CURATOR_IMPORT_SCOPE } from '@kitchensink/schema-recipe';
import { z } from 'zod';

/** The part of the credential file this suite reads. */
const credentialFileSchema = z.object({ token: z.string().min(1) });

/** The part of a token's claims the grant lives in. */
const grantClaimsSchema = z.object({
    public_metadata: z.object({ scopes: z.array(z.string()) }),
});

/**
 * Parse a JSON text, or yield `undefined` for one that is not JSON, which the schema then refuses. Pure.
 *
 * @param text - The text.
 * @returns The parsed value.
 */
function jsonOf(text: string): unknown {
    try {
        return JSON.parse(text) as unknown;
    } catch {
        return undefined;
    }
}

/**
 * The curator's bearer, from the credential file's text. Pure.
 *
 * @param fileText - The credential file's contents.
 * @returns The token.
 * @throws {Error} When the file is not a credential, or its token does not carry {@link CURATOR_IMPORT_SCOPE}.
 */
export function curatorTokenOf(fileText: string): string {
    const file = credentialFileSchema.safeParse(jsonOf(fileText));

    if (!file.success) {
        throw new Error(`the curator credential file is not a minted credential: ${file.error.message}`);
    }

    const claims = grantClaimsSchema.safeParse(decodeClaims(file.data.token));

    if (!claims.success || !claims.data.public_metadata.scopes.includes(CURATOR_IMPORT_SCOPE)) {
        throw new Error(
            `the curator token carries no ${CURATOR_IMPORT_SCOPE} in its signed public_metadata.scopes. The linkage ` +
                'lane declares it in packages/tools/e2e-fixtures/src/testPool.ts, so its Clerk user has not been ' +
                're-provisioned: run poolAdmin --apply.',
        );
    }

    return file.data.token;
}
