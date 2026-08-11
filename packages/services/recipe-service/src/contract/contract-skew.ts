/**
 * DRIFT LAYER 3 (Skew) — the boot assertion over the two `CONTRACT_HASH` stamps
 * (`docs/CODING_STANDARDS.md` §15.2.5).
 *
 * The generator writes one fingerprint of the authored `*.schema.ts` corpus into TWO places: this service
 * (`./contract-hash.ts`) and the generated leaf package `@kitchensink/schema-recipe`. This module asserts, at
 * boot, that the image it is running in carries the same value in both.
 *
 * ── WHAT IT CATCHES, AND — SAID PLAINLY — WHAT IT CANNOT ──
 *
 * Both stamps are STATIC COMMITTED FILES written from ONE computed hash in ONE generator run, so what this
 * assertion proves is narrow and worth stating exactly: **the two stamp files in this image came from the same
 * tree.** It fires when a commit carried a hand-edit of one, or carried one file and not the other, or when an
 * image was assembled from mixed sources (a stale `node_modules` copy of the leaf package against a fresh service
 * build). CI's regenerate-and-diff gate (layer 2) already catches the committed-tree version of that at PR time;
 * the value here is the same class reaching an image built OUTSIDE that path.
 *
 * ⚠️ IT THEREFORE DOES **NOT** CATCH "the published contract does not describe this binary" IN GENERAL, and
 * reading it that way is the trap. An image built from a tree where a `*.schema.ts` was edited but
 * `contract:generate` was never run carries two IDENTICAL stamps — both stale — and boots perfectly clean while
 * serving a shape NEITHER stamp describes. Nothing at runtime can see that, because the authored sources are not
 * in the image and the fingerprint is not recomputed from them; only layer 2, in CI, compares a stamp against a
 * fresh derivation. A hand-built container, a bypassed gate or a partially-applied hotfix is caught here ONLY if
 * it mixed the two stamps, not merely because it skipped generation.
 *
 * ⚠️ IT DOES **NOT** CATCH THE SKEW §15.2.5 NAMES AS THE MOTIVATING CASE: a deployed service running ahead of
 * a CONSUMER's pinned schema — the released mobile binary that cannot be updated in step with a backend
 * deploy. That comparison is inherently cross-process: the device's copy of `@kitchensink/schema-recipe` was
 * pinned at ITS build time and is not present in this process. Detecting it requires the service to PUBLISH its
 * hash and the client to compare — which is why `GET /health` now carries `contractHash`. The client-side
 * comparison (and the policy question of whether a mismatch should warn or refuse) is deliberately NOT decided
 * here; it changes client behaviour for every consumer and wants an explicit ruling.
 *
 * ── WHY IT IS FAIL-CLOSED, AND WHY THAT COSTS NO AVAILABILITY ──
 *
 * A boot check that refuses to serve is normally a 3am-outage risk. This one is not, and the reason is
 * structural rather than optimistic: BOTH values are baked into the image at build time. The check cannot be
 * affected by config, by a dependency outage, by load, or by a retry — its outcome is fully determined by the
 * artifact. An image that boots once boots always; an image that fails was never going to serve a contract
 * anyone could trust. And it is not first discovered in production either: `__tests__/contract-skew.test.ts`
 * asserts the two COMMITTED stamps agree, so the failure lands on `npm test`.
 *
 * DESIGN PATTERN: Specification (a single pure predicate) plus the repo's custom-error convention — `Error`
 * subclass, `Object.setPrototypeOf`, and a matching `is*` guard.
 */

/** A lower-case hex SHA-256, which is what the generator emits. */
const SHA256_HEX = /^[0-9a-f]{64}$/u;

/**
 * Thrown when the service-embedded contract fingerprint does not match the schema package's.
 *
 * Carries both values as fields, not just in the message, so a structured logger records them without having
 * to parse prose.
 */
export class ContractSkewError extends Error {
    /** The fingerprint compiled into this service. */
    public readonly serviceHash: string;

    /** The fingerprint published by `@kitchensink/schema-recipe`. */
    public readonly schemaPackageHash: string;

    public constructor(serviceHash: string, schemaPackageHash: string) {
        super(
            'CONTRACT SKEW — refusing to start. The wire-contract fingerprint compiled into this service does ' +
                'not match the one published by @kitchensink/schema-recipe, so the contract every client ' +
                'compiles against does not describe this binary.\n' +
                `  service (src/contract/contract-hash.ts): ${serviceHash || '<empty>'}\n` +
                `  @kitchensink/schema-recipe:               ${schemaPackageHash || '<empty>'}\n` +
                'Both stamps come from ONE generator run, so this image was not built from a tree where they ' +
                "agreed. Run 'npm run contract:generate', commit both files, and rebuild.",
        );
        this.name = 'ContractSkewError';
        this.serviceHash = serviceHash;
        this.schemaPackageHash = schemaPackageHash;

        // Restore the prototype chain (transpilation to ES targets breaks `instanceof` otherwise).
        Object.setPrototypeOf(this, ContractSkewError.prototype);
    }
}

/** Type guard for {@link ContractSkewError} instances. */
export function isContractSkewError(value: unknown): value is ContractSkewError {
    return value instanceof ContractSkewError;
}

/**
 * Assert that the two contract fingerprints agree, and that each is a well-formed one.
 *
 * The FORMAT check is not decoration. A bare equality test passes happily on two empty strings, two `undefined`
 * values coerced to `'undefined'`, or two identically-truncated stamps — all of which mean the stamp mechanism
 * broke, which is exactly when the equality result is meaningless. Requiring a lower-case 64-hex SHA-256 on
 * both sides turns "the stamps are missing" from a silent pass into the same loud failure as a real mismatch.
 *
 * @param serviceHash - The fingerprint compiled into this service.
 * @param schemaPackageHash - The fingerprint published by the generated schema package.
 * @throws {ContractSkewError} When either stamp is malformed, or the two differ.
 */
export function assertContractHashesAgree(serviceHash: string, schemaPackageHash: string): void {
    if (!SHA256_HEX.test(serviceHash) || !SHA256_HEX.test(schemaPackageHash)) {
        throw new ContractSkewError(serviceHash, schemaPackageHash);
    }

    if (serviceHash !== schemaPackageHash) {
        throw new ContractSkewError(serviceHash, schemaPackageHash);
    }
}
