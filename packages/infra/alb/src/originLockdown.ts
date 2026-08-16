/**
 * Who may reach the shared ALB on `:443` — the internet, or only CloudFront (U17's origin lockdown).
 *
 * @implements ADR-0020
 */

/** The stage fronted by a CloudFront distribution, and so the only stage that can be locked down. */
const EDGE_STAGE = 'prod';

/**
 * The AWS-managed prefix list for CloudFront's origin-facing address ranges, in the commercial partition.
 *
 * ⚠️ A LITERAL id is correct here, unusually. Managed prefix lists have no CDK lookup and no
 * `Fn::FindInMap` equivalent, and `com.amazonaws.global.cloudfront.origin-facing` is a **global** list
 * whose id is stable per region; this account is us-east-1-only (`bin/app.ts` defaults the region and
 * every stack is deployed there). Verified live against `ec2 describe-managed-prefix-lists` in
 * account 040663841500 on 2026-08-16.
 */
export const CLOUDFRONT_ORIGIN_FACING_PREFIX_LIST = 'pl-3b927c52';

/**
 * ⛔ What one prefix-list rule COSTS against the security-group quota — the trap that makes a second one
 * impossible.
 *
 * A managed prefix list consumes its **weight**, not its current entry count, against the
 * "inbound rules per security group" quota (`L-0EA8095F`, default **60**). CloudFront's weight is 55; the
 * list held 46 entries when this was written, and reading the live count is exactly the mistake — AWS has
 * raised this weight before (30 → 55) and will not re-invalidate existing rules when it does.
 *
 * So: **one** such rule fits, with four to spare. A second (the `:80` listener, or the separate IPv6 list
 * `com.amazonaws.global.ipv6.cloudfront.origin-facing`, also weight 55) costs 110 and the deploy fails
 * with `RulesPerSecurityGroupLimitExceeded`. Because `NetworkStack` is the root of the prod dependency
 * chain, that surfaces as an `UPDATE_FAILED` blocking EVERY prod infra deploy, months later, looking
 * nothing like the edge change that caused it.
 *
 * The ALB is IPv4-only (`SharedAlbStack` sets no `ipAddressType`), which is what makes the IPv4 list
 * sufficient — flipping it to dualstack would need the IPv6 list, and there is no room for it.
 */
export const CLOUDFRONT_PREFIX_LIST_RULE_WEIGHT = 55;

/**
 * Resolve the source that may reach the shared ALB on `:443` for a stage. Pure and total.
 *
 * Returns the prefix-list id in prod, where CloudFront is the only legitimate client, and `undefined`
 * everywhere else — sandbox and every per-PR preview have no distribution and must keep reaching their own
 * ALB directly. Absence IS the prod gate, the same shape `internalOriginForStage` uses, so there is never
 * a second `stage === 'prod'` written somewhere else to drift from this one.
 *
 * ⚠️ This restricts traffic to **CloudFront**, not to **our** CloudFront: the origin hostnames are
 * published in the public zone, so anyone may point their own distribution at one. It is L3/L4 hygiene,
 * and the boundary is the secret origin header that accompanies it. See ADR-0020's U17 correction — and
 * note that the edge was never the authentication boundary either, since every origin re-verifies the
 * caller's token independently.
 *
 * @param stage - The deploy stage.
 * @returns The CloudFront prefix-list id in prod, otherwise `undefined` (meaning "open to the internet").
 */
export function albHttpsIngressPrefixListFor(stage: string): string | undefined {
    return stage === EDGE_STAGE ? CLOUDFRONT_ORIGIN_FACING_PREFIX_LIST : undefined;
}
