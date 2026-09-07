/**
 * The shared secret that proves a request to the origin came from OUR CloudFront — the boundary the
 * prefix-list restriction is not.
 *
 * `albHttpsIngressPrefixListFor` restricts prod's ALB `:443` to CloudFront's origin-facing address ranges,
 * which authorizes **CloudFront**, not **our** CloudFront. The origin hostnames live in the PUBLIC Route 53
 * zone, so anyone may point their own distribution at `food.internal.commise.app` and reach the ALB with the
 * viewer-request verifier out of the path. AWS says so on the page that recommends the prefix list, where it
 * is marked optional and the mechanism for "only through CloudFront" is this header: _"If the header name and
 * value are not secret, other HTTP clients could potentially include them in requests that they send directly
 * to the Application Load Balancer."_
 *
 * ## What breaks if this is got wrong
 *
 * Four independently-deployed templates have to agree on one name and one value, and none of them can see the
 * others: `DomainStack` mints the secret, `EdgeStack` sends it on every origin request, and the three service
 * stacks each require it as a listener-rule condition. A disagreement does not fail synth — it fails as
 * ADR-0003's default `404`, in production, for every request to the service that disagreed. That is the same
 * hazard `listenerPriority.ts` and `internalOriginHost.ts` were extracted for, so this is one module and one
 * resolver, and nothing restates it.
 *
 * ## The header NAME is public on purpose
 *
 * Only the VALUE is secret. A secret name would make every `cdk diff`, log line and 404 debugging session
 * opaque, and buys nothing: the value is 64 random characters carried to the origin over TLS
 * (`OriginProtocolPolicy.HTTPS_ONLY`), so an attacker who cannot read the value cannot use the name.
 *
 * @implements ADR-0020
 */
import { EDGE_STAGE } from './edgeStage.js';
import { SecretValue } from 'aws-cdk-lib';

/** The stage fronted by a CloudFront distribution, and so the only stage that can require this header. */

/**
 * The header CloudFront adds to every origin request and the ALB requires.
 *
 * ⚠️ Not renameable to anything `x-forwarded-*`, `x-amz-cf-*`, `x-amzn-*`, `x-edge-*`, `if-*` or `x-accel-*`,
 * nor to `Host`/`Cookie`/`Via`/`Cache-Control` and the rest of CloudFront's `OriginCustomHeaders` denylist —
 * those are rejected outright, and an `x-forwarded-*` name would additionally collide with headers a client
 * can supply, which turns the check into a comparison against attacker-controlled input.
 */
export const EDGE_ORIGIN_HEADER_NAME = 'x-commise-edge';

/** The Secrets Manager secret CloudFormation generates the value into. Prod-only, like the header itself. */
const EDGE_ORIGIN_HEADER_SECRET_NAME = `kitchensink/${EDGE_STAGE}/edge/origin-header`;

/** The JSON key inside that secret. `DomainStack` generates into it; the dynamic reference reads it back. */
const EDGE_ORIGIN_HEADER_SECRET_JSON_FIELD = 'value';

/**
 * ⛔ ALB's cap on a single listener-rule condition value — the ceiling the generated length sits under.
 *
 * A longer value is refused at deploy time, and by then CloudFront is already sending it, so the ALB is the
 * half that fails: the rule cannot be updated and the origin keeps answering on the host condition alone.
 */
export const ALB_CONDITION_VALUE_MAX_LENGTH = 128;

/**
 * How many characters CloudFormation generates.
 *
 * ⚠️ The ALPHABET, not just the length, is load-bearing. `DomainStack` passes `excludePunctuation: true`
 * because **ALB treats `*` and `?` in a condition value as WILDCARDS** — a generated value containing either
 * would silently become a pattern that admits values nobody ever generated. What remains is the 62-character
 * alphanumeric alphabet, and 64 of those is ~381 bits, well inside {@link ALB_CONDITION_VALUE_MAX_LENGTH}.
 */
export const EDGE_ORIGIN_HEADER_VALUE_LENGTH = 64;

/**
 * The CloudFormation dynamic reference for the secret's value.
 *
 * Resolved ONCE at module scope rather than per call: `SecretValue` hands back a token, and a fresh token per
 * call would make this resolver unequal to itself while still resolving identically — a trap for any caller
 * that compares or caches the result.
 *
 * `unsafeUnwrap` is correct despite the name. CDK's warning is about contexts where CloudFormation will not
 * resolve the reference; both consumers here — an ALB listener-rule condition value and a CloudFront origin
 * custom header — are ordinary resource properties, which do resolve. (The documented exclusions are custom
 * resources, `CloudFormation::Init` metadata and EC2 `UserData`.) Measured output, synthesized 2026-08-16:
 * `{{resolve:secretsmanager:kitchensink/prod/edge/origin-header:SecretString:value::}}`.
 *
 * ⛔ Secrets Manager, NOT an SSM `SecureString`. `{{resolve:ssm-secure:…}}` is supported in only a short
 * enumerated set of resource properties, and neither of the two above is on it.
 */
const EDGE_ORIGIN_HEADER_VALUE = SecretValue.secretsManager(EDGE_ORIGIN_HEADER_SECRET_NAME, {
    jsonField: EDGE_ORIGIN_HEADER_SECRET_JSON_FIELD,
}).unsafeUnwrap();

/**
 * The secret origin header, in the three forms its consumers need.
 *
 * They are returned together, from one computation, because they are one fact seen from four sides. Deriving
 * any of them at a call site is where they would drift, and a service whose condition names a different
 * header or a different secret than the distribution sends is a service that answers `404` to everything.
 */
export interface EdgeOriginHeader {
    /** The header name CloudFront sends and the ALB matches, e.g. `x-commise-edge`. Not secret. */
    readonly headerName: string;
    /** The Secrets Manager secret `DomainStack` mints. Naming it from here is what keeps the two in step. */
    readonly secretName: string;
    /** The value, as a CloudFormation dynamic reference — never the secret itself. */
    readonly value: string;
}

/**
 * Resolve the secret origin header for a stage. Pure and total.
 *
 * @param stage - The deploy stage.
 * @returns The header in prod, otherwise `undefined` — sandbox and every per-PR preview have no distribution
 *   to send it, so a rule requiring it there matches nothing and takes the whole stage offline.
 */
export function edgeOriginHeaderFor(stage: string): EdgeOriginHeader | undefined {
    if (stage !== EDGE_STAGE) {
        return undefined;
    }

    return {
        headerName: EDGE_ORIGIN_HEADER_NAME,
        secretName: EDGE_ORIGIN_HEADER_SECRET_NAME,
        value: EDGE_ORIGIN_HEADER_VALUE,
    };
}
