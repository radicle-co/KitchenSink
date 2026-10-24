/**
 * THE names of the SSM parameters the remote search service is wired through (ADR-0055) — one module, every app
 * that writes or reads them: `packages/infra/global` publishes the base stage's shared values, the remote search
 * stack publishes its origin and reads the shared values, and food reads the origin and the signing key.
 *
 * Two scopes, and the split is the design. What an account caps is ONE per base stage, so a copy per pull request
 * cannot each create it: CloudFront holds at most ten public keys and about twenty cache policies and twenty origin
 * request policies per account. Every search copy publishes only its own origin. A name built by hand in three apps
 * is three chances for a reader and its writer to disagree, which fails only at deploy, as "Unable to fetch
 * parameters".
 *
 * SSM rather than `Fn.importValue`, so no stack can hold another's deletion hostage.
 *
 * @module
 */

/**
 * The base stage's shared values: the key group a distribution trusts and what food signs with, and the cache
 * policy, origin request policy and origin access control every copy's distribution uses.
 */
export type RemoteSearchSharedParameter =
    | 'key-group-id'
    | 'key-pair-id'
    | 'signing-key-secret-arn'
    | 'cache-policy-id'
    | 'origin-request-policy-id'
    | 'origin-access-control-id';

/**
 * Where a base stage's shared value is published. Pure.
 *
 * @param baseStage - The base stage that owns it (`prod`, or `sandbox` for every preview).
 * @param parameter - Which value.
 * @returns `/kitchensink/{baseStage}/remote-search/{parameter}`.
 */
export function remoteSearchSharedParameter(baseStage: string, parameter: RemoteSearchSharedParameter): string {
    return `/kitchensink/${baseStage}/remote-search/${parameter}`;
}

/**
 * Where a search copy publishes its distribution's `https://` origin. Pure.
 *
 * @param stage - The copy's stage (`prod`, or a preview's `pr-{N}`).
 * @returns `/kitchensink/{stage}/remote-search/origin`.
 */
export function remoteSearchOriginParameter(stage: string): string {
    return `/kitchensink/${stage}/remote-search/origin`;
}
