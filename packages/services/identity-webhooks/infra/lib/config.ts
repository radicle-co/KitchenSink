export const SECRET_PATHS = {
    prod: 'kitchensink/prod/identity/keys',
    sandbox: 'kitchensink/sandbox/identity/keys',
} as const;

/**
 * Org-standard stage-first SSM layout — `/kitchensink/{stage}/{service}/{key}` — matching Secrets
 * Manager (`kitchensink/{stage}/identity/keys`). Covers both the clerk JWT-validation params and the
 * sentry DSNs.
 */
export function ssmParamPath(stage: string, service: 'clerk' | 'sentry', key: string): string {
    return `/kitchensink/${stage}/${service}/${key}`;
}

export function getAuthSecretName(stage: string): string {
    return stage === 'prod' ? SECRET_PATHS.prod : SECRET_PATHS.sandbox;
}

/**
 * The Secrets Manager secret holding the CR-002 / U4b erasure fan-out EdDSA keypair for a stage. The
 * deletion-worker + erasure-reconciliation Lambdas embed its `SIGNING_KEY` (PKCS#8 private PEM) field at
 * deploy; the recipe + food services hold the matching PUBLIC key (see {@link erasureSsmPath}).
 *
 * **Deferred key-provisioning seam (continues U4a).** The keypair CANNOT be CDK-generated coherently across
 * three stacks — ops generates one Ed25519 keypair per stage, stores the private PEM in this secret's
 * `SIGNING_KEY` field, and the public PEM in the per-service SSM params. Until that exists, the fan-out
 * fails CLOSED (loud DLQ + the erasure-reconciliation alarm), never silently.
 */
export function getErasureSigningSecretName(stage: string): string {
    return `kitchensink/${stage === 'prod' ? 'prod' : 'sandbox'}/erasure/keys`;
}

/**
 * SSM path for a non-secret CR-002 erasure fan-out value (the recipe/food base URLs). Stage-first, matching
 * {@link ssmParamPath}. Ops populates these with each service's public origin before the U4b deploy.
 */
export function erasureSsmPath(stage: string, key: 'recipe-base-url' | 'food-base-url'): string {
    return `/kitchensink/${stage}/erasure/${key}`;
}
