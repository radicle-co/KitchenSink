/**
 * Lambda adapter for the CloudFront viewer-request verifier (ADR-0020 / plan U16).
 *
 * Deliberately the thinnest file in the unit: it binds the build-time-inlined verification key to
 * `createClerkEdgeVerifier` and exports the result as `handler`. Everything decidable lives in
 * `lib/edge-verifier/`, and the real composition is exercised end to end — with real RS256 tokens and the
 * real verifier — by `__tests__/edgeVerifier.integration.test.ts`.
 *
 * ⛔ THE KEY IS INLINED AT BUILD TIME, and it has to be. Lambda@Edge cannot read environment variables, and
 * this repository's `ssm.StringParameter.valueForStringParameter` pattern resolves at DEPLOY time — too late
 * for an asset bundled and hashed at synth. `esbuild.mjs` substitutes the identifier named by
 * `EDGE_JWT_KEY_GLOBAL` (`./edgeBuildContract.ts`) via `define`, from a `CLERK_JWT_KEY` that CI exports from
 * SSM before the bundle step. The key is PUBLIC
 * (it verifies signatures, it does not make them), so nothing secret is embedded — but a rotation is now a
 * rebuild plus CloudFront propagation, not a restart. See ADR-0020's runbook section.
 *
 * The identifier is `declare`d rather than read from `process.env` because esbuild's `define` substitutes
 * dotted/plain identifiers only — and `process.env.X` is a type error under this repo's
 * `noPropertyAccessFromIndexSignature`, while `process.env['X']` is not a substitution target at all.
 *
 * @sideEffect Reads no environment and performs no I/O: verification is networkless (a `jwtKey`, never a
 *   `secretKey`), which is what keeps a viewer-request function inside its 5-second ceiling.
 */
import { createClerkEdgeVerifier } from './clerkEdgeVerifier.js';
import { reportEdgeFailure } from './edgeObservability.js';

/**
 * The build-time constant esbuild replaces with the Clerk instance's PEM public key.
 *
 * Unresolvable at runtime by design: if the bundle were ever built without the `define`, this reference
 * would throw a `ReferenceError` on the first invocation rather than verifying nothing. `EdgeStack` refuses
 * to synthesize a bundle that was not built with the key it was handed, so that state should be
 * unreachable — this is the second lock on the same door.
 */
declare const __CLERK_EDGE_JWT_KEY__: string;

/** The stage this bundle was built for, compiled in beside the key. Empty outside a real build. */
declare const __EDGE_STAGE__: string;

const verify = createClerkEdgeVerifier(__CLERK_EDGE_JWT_KEY__);

/**
 * The CloudFront viewer-request entry point, with a REPORTING boundary (plan U20).
 *
 * ⛔ THIS IS THE ONLY PATH BY WHICH THIS FUNCTION'S FAILURES BECOME VISIBLE. ADR-0042 leaves Lambda@Edge out
 * of the log drain on purpose — a replica writes to a log group in whichever region served the viewer, and no
 * single stack can enumerate them — so an unexpected throw here returned a CloudFront error to a real viewer
 * and was recorded nowhere anybody would look.
 *
 * ⛔ A REJECTED TOKEN IS NOT A FAILURE and is not reported: that is the function doing its job, on every
 * request from every signed-out browser and every bot, and reporting it would be an issue per request. The
 * verifier's own `catch` already turns those into a `401` without ever reaching here.
 *
 * ⛔ AND THE REPORT NEVER CHANGES THE ANSWER. It is awaited under a deadline well inside the function's
 * timeout and every failure inside it is swallowed, then the original error is re-thrown — so CloudFront's
 * behaviour on a verifier bug is exactly what it was before, with a Sentry issue that did not exist before.
 *
 * @sideEffect May issue one bounded HTTP POST to Sentry.
 */
export const handler: typeof verify = async (event) => {
    try {
        return await verify(event);
    } catch (error) {
        await reportEdgeFailure(error, {
            stage: typeof __EDGE_STAGE__ === 'string' && __EDGE_STAGE__ ? __EDGE_STAGE__ : 'prod',
            distributionId: event.Records[0]?.cf.config.distributionId ?? 'unknown',
        });

        throw error;
    }
};
