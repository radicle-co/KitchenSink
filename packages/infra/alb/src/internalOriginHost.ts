/**
 * THE authority for the internal-origin hostname each service answers on behind the CloudFront edge
 * (ADR-0020 / plan U15). One module, one resolver — every service stack and the edge stack import it;
 * none restates it.
 *
 * ## Why this is one function and not a template string in three stacks
 *
 * Four independently-deployed stacks have to agree on a single string. The service stack matches it as an
 * ALB listener-rule host condition, publishes it as a Route 53 record, and (U16) `EdgeStack` names it as a
 * CloudFront origin. Nothing checks that those agree: a mismatch synthesizes clean and surfaces in
 * production as a TLS handshake failure or the shared listener's default `404`. That is the same hazard
 * `listenerPriority.ts` was extracted for, one namespace over — and there the copy-per-service
 * had already drifted before anyone noticed.
 *
 * ## The shape, and the two ways to get it wrong
 *
 * `{service}.internal.{apex}` — the label order matters. `DomainStack`'s additive certificate is
 * `*.internal.{apex}`, a wildcard that matches EXACTLY ONE label to its left, so:
 *
 *   - `internal.food.commise.app` (transposed) matches no certificate on the listener; and
 *   - a two-label left side matches no certificate either, which is the same trap
 *     `foodSubdomainForStage` documents for `food.pr-7` vs `food-pr-7` (ADR-0006).
 *
 * Both are covered by tests here rather than left to review.
 *
 * ## Prod only
 *
 * KTD-7 scopes CloudFront to production, so production is the only stage whose `DomainStack` mints the
 * `*.internal` certificate. Returning `undefined` elsewhere puts that ruling in ONE place: a stack that
 * simply forwards the absence cannot accidentally attach an internal host condition on sandbox, where no
 * certificate exists to terminate it.
 *
 * @module
 */

import { type SharedListenerService } from './listenerPriority.js';

export { type SharedListenerService };

/**
 * The DNS label separating a service's internal origin from the apex — the middle label of
 * `{service}.internal.{apex}` and the one the additive ACM wildcard is issued for.
 *
 * Exported so `DomainStack`'s certificate and the hosts that must match it cannot be spelled apart.
 */
export const INTERNAL_ORIGIN_LABEL = 'internal';

/** The stage that owns the CloudFront edge, and therefore the only stage with internal origins (KTD-7). */
const EDGE_STAGE = 'prod';

/** Everything needed to resolve one service's internal origin. An object, so the strings cannot be swapped. */
export interface InternalOriginRequest {
    /** The service claiming the origin — the same registry the listener-priority allocator is keyed on. */
    readonly service: SharedListenerService;
    /** The deploy stage (`prod`, `sandbox`, `pr-{N}`, …). Only `prod` has an edge. */
    readonly stage: string;
    /** The apex domain the hosted zone is authoritative for, e.g. `commise.app`. */
    readonly domainName: string;
}

/**
 * A service's internal origin, in the two forms its consumers need.
 *
 * They are returned together, from one computation, because they are one fact seen from two sides: the
 * ALB matches the fully-qualified `host`, while Route 53 publishes `recordName` INSIDE the apex zone.
 * Deriving one from the other at a call site is where they would drift apart, and a record that does not
 * resolve to the host the rule matches is an origin that is simply unreachable.
 */
export interface InternalOrigin {
    /** The fully-qualified origin host, e.g. `food.internal.commise.app`. */
    readonly host: string;
    /** The same name RELATIVE to the apex hosted zone, e.g. `food.internal` — what `ARecord` wants. */
    readonly recordName: string;
}

/**
 * Resolve the internal origin host for one service at one stage. Pure and total.
 *
 * @param request - The service, its stage, and the apex domain.
 * @returns The origin's host and zone-relative record name, or `undefined` outside prod — where there is
 *   no distribution to origin from and no `*.internal` certificate to terminate the name.
 */
export function internalOriginForStage(request: InternalOriginRequest): InternalOrigin | undefined {
    const { service, stage, domainName } = request;

    if (stage !== EDGE_STAGE) {
        return undefined;
    }

    const recordName = `${service}.${INTERNAL_ORIGIN_LABEL}`;

    return { host: `${recordName}.${domainName}`, recordName };
}
