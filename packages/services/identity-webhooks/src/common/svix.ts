import { Webhook } from 'svix';

/**
 * Verify an inbound Clerk webhook's svix signature and return its payload as UNTRUSTED data.
 *
 * ⚠️ THE RETURN TYPE IS `unknown`, AND THAT IS THE POINT. This used to end in
 * `wh.verify(payload, headers) as IdpWebhookEvent`, which handed the caller a fully-typed object the compiler
 * would then let it destructure freely — so the function's signature ASSERTED a shape that nothing had
 * checked. A signature proves Clerk SENT the payload; it says nothing whatsoever about what is inside it, and
 * Clerk is a third party who can change `UserJSON` without telling us.
 *
 * Returning `unknown` makes that distinction impossible to ignore: the caller cannot read a field without
 * first parsing it (`idpWebhookEventSchema`), so the type system now enforces the boundary instead of papering
 * over it. Do NOT re-add a cast here — the cast is what let a shape-invalid payload reach `db.update(users)`,
 * an outbound Clerk call, and an SNS publish consumed by another service.
 *
 * @param headers - The request headers (svix reads `svix-id`, `svix-timestamp`, `svix-signature`).
 * @param rawBody - The EXACT raw body. Signature verification is over the raw bytes, so a re-serialized body
 *   will not verify.
 * @param secret - The svix signing secret.
 * @returns The signature-verified payload, still unvalidated in shape.
 * @throws When the signature is missing, malformed, expired, or does not match.
 */
export function verifyWebhook(headers: Record<string, string>, rawBody: string | Buffer, secret: string): unknown {
    const wh = new Webhook(secret);
    const payload = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');

    return wh.verify(payload, headers);
}
