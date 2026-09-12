/**
 * The stage fronted by the CloudFront edge — ONE fact, four consumers.
 *
 * `internalOriginHost`, `publicRecordOwner`, `originLockdown` and `edgeOriginHeader` all gate on it, and
 * each briefly carried its own private copy. They are not look-alikes: they change for the same reason.
 * Standing an edge up in front of sandbox moves all four together, and moving fewer than four produces a
 * configuration that cannot work rather than one that merely differs — an ALB restricted to CloudFront on
 * a stage with no distribution is unreachable, and a distribution whose origin has no internal name
 * resolves to nothing.
 *
 * ⚠️ Every consumer must compare with `===`. A `startsWith`, a `toLowerCase`, or a trim would let `prod-2`
 * or `preprod` light up one resolver and not the others, and the resulting deployment is off the internet
 * with a clean template and a green deploy. `edgeStage.test.ts` asserts the four agree for every stage,
 * which sharing this constant alone does not prove.
 *
 * @implements ADR-0020
 */

/** The one production stage with a CloudFront distribution in front of it (ADR-0020). */
export const EDGE_STAGE = 'prod';
