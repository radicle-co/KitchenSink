/**
 * A check of a CloudFront canned-policy signed URL, as the distribution makes it before it serves anything (ADR-0055
 * point 7): the signature must verify over `{"Statement":[{"Resource":<url>,"Condition":{"DateLessThan":{"AWS:EpochTime":
 * <Expires>}}}]}` with the key pair's public key, the URL being everything before the signing parameters, and `Expires`
 * must not have passed. So a request whose `q`, `admit` or `rid` differs from what food signed is refused.
 *
 * It models the check, not CloudFront: it proves food signs what it sends.
 */
import { createVerify, type KeyObject } from 'node:crypto';

/** The parameters the signer appends, in its order. */
const SIGNING_PARAMETERS = ['Expires', 'Signature', 'Key-Pair-Id', 'Hash-Algorithm'] as const;

/** Why a signed URL is refused. */
export type SignatureRefusal = 'unsigned' | 'wrongKeyPair' | 'expired' | 'badSignature';

/** A signed URL's check: the URL it signs, or why it is refused. */
export type SignatureCheck =
    { readonly ok: true; readonly resource: string } | { readonly ok: false; readonly refusal: SignatureRefusal };

/**
 * The URL a signed URL signs: everything before its first signing parameter.
 *
 * @param signed - The signed URL.
 * @returns The resource, or `undefined` when the URL carries no signature.
 */
function resourceOf(signed: string): string | undefined {
    const at = signed.search(/[?&]Expires=/u);

    return at === -1 ? undefined : signed.slice(0, at);
}

/**
 * CloudFront's base64 back to standard base64.
 *
 * @param value - The URL-safe form (`-`, `_`, `~`).
 * @returns Standard base64.
 */
function standardBase64(value: string): string {
    return value.replaceAll('-', '+').replaceAll('_', '=').replaceAll('~', '/');
}

/**
 * Check a canned-policy signed URL.
 *
 * @param signed - The URL as received.
 * @param key - The key pair's public key and id.
 * @param key.publicKey - The public key.
 * @param key.keyPairId - The key pair id the URL must name.
 * @param nowSeconds - The current time, epoch seconds.
 * @returns The signed resource, or the refusal.
 */
export function checkSignedUrl(
    signed: string,
    key: { readonly publicKey: KeyObject; readonly keyPairId: string },
    nowSeconds: number,
): SignatureCheck {
    const resource = resourceOf(signed);
    const params = new URL(signed).searchParams;
    const [expires, signature, keyPairId, algorithm] = SIGNING_PARAMETERS.map((name) => params.get(name));

    if (resource === undefined || expires === null || signature === null || keyPairId === null) {
        return { ok: false, refusal: 'unsigned' };
    }

    if (keyPairId !== key.keyPairId) {
        return { ok: false, refusal: 'wrongKeyPair' };
    }

    if (!/^\d+$/u.test(expires) || Number(expires) <= nowSeconds) {
        return { ok: false, refusal: 'expired' };
    }

    const policy = JSON.stringify({
        Statement: [{ Resource: resource, Condition: { DateLessThan: { 'AWS:EpochTime': Number(expires) } } }],
    });
    const verify = createVerify(algorithm === 'SHA256' ? 'RSA-SHA256' : 'RSA-SHA1');

    verify.update(policy);

    return verify.verify(key.publicKey, standardBase64(signature), 'base64')
        ? { ok: true, resource }
        : { ok: false, refusal: 'badSignature' };
}
