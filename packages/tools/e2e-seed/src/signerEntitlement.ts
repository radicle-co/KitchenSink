/**
 * The pool signer's entitlement, read from identity BEFORE `provision` seeds the signer's world.
 *
 * Why: every Maestro flow of one run failed in its per-flow reset with `400 INVALID_VISIBILITY`. The pool signers'
 * Clerk users carried no roles — `poolAdmin --apply` had not been run after the roster gave them `premium` — and the
 * seeded world gives the signer PRIVATE recipes, which the recipe service admits only for an entitled caller. Each
 * flow then failed one by one, reading like thirty app defects. Identity states the entitlement as
 * `account.paidFeatures` (`granted` for an entitled role), so asking it once, as the signer, names the real cause
 * before anything is written.
 *
 * ⚠️ `granted` is identity's PRESENTATION of the roles; recipe authorizes the write from the same roles
 * (`paidFeatureAccess.ts`: "the gate changes what is shown, never who is allowed"). They agree by construction, which
 * is why this check is the right proxy — but the recipe service, not this check, is the authority.
 *
 * @pattern Specification — `judgeSignerEntitlement` is a pure predicate over identity's published profile shape
 */
import { userProfileSchema, type PaidFeatures } from '@kitchensink/schema-identity';

import { withoutTrailingSlashes } from './env.js';
import { requestIdentity, type IdentityDeps, type IdentityRetry } from './identityRequest.js';
import { SignerStillEntitledError } from './signerStillEntitledError.js';

/**
 * The one field this check reads, DERIVED from identity's published profile (ADR-0014: derive, never redeclare).
 * Parsing the whole profile would make an unrelated field's drift (a new `user` column) read as "not a profile".
 */
const signerEntitlementBodySchema = userProfileSchema
    .pick({ account: true })
    .extend({ account: userProfileSchema.shape.account.pick({ paidFeatures: true }) });

/** What identity says about the signer. Only `entitled` lets `provision` seed. */
export type SignerEntitlement =
    | { readonly kind: 'entitled' }
    | { readonly kind: 'notEntitled'; readonly paidFeatures: PaidFeatures }
    | { readonly kind: 'unreadable'; readonly reason: string };

/** Raised when the signer is readable and not entitled — the one failure whose fix is `poolAdmin --apply`. */
export class SignerNotEntitledError extends Error {
    public readonly paidFeatures: PaidFeatures;

    public constructor(message: string, paidFeatures: PaidFeatures) {
        super(message);
        this.name = 'SignerNotEntitledError';
        this.paidFeatures = paidFeatures;
        Object.setPrototypeOf(this, SignerNotEntitledError.prototype);
    }
}

/**
 * Type guard for {@link SignerNotEntitledError}.
 *
 * @param error - The value to test.
 * @returns `true` when the signer was read and is not entitled.
 */
export function isSignerNotEntitledError(error: unknown): error is SignerNotEntitledError {
    return error instanceof SignerNotEntitledError;
}

/**
 * Judge a `GET /api/v1/users/me` body against the part of identity's published schema this check reads. Pure.
 *
 * @param body - The parsed response body.
 * @returns `entitled` only for `account.paidFeatures === 'granted'`.
 */
export function judgeSignerEntitlement(body: unknown): SignerEntitlement {
    const parsed = signerEntitlementBodySchema.safeParse(body);

    if (!parsed.success) {
        const where = parsed.error.issues.map((issue) => `${issue.path.join('.') || '(body)'}: ${issue.message}`);

        return { kind: 'unreadable', reason: `the body is not the profile identity publishes (${where.join('; ')})` };
    }

    const { paidFeatures } = parsed.data.account;

    return paidFeatures === 'granted' ? { kind: 'entitled' } : { kind: 'notEntitled', paidFeatures };
}

/** How the read rides out a cold identity task (the one bound every call to identity shares). */
export type EntitlementRetry = IdentityRetry;

/** Injected so the unit tier needs no network and no timers. */
export type EntitlementDeps = IdentityDeps;

/** Who is asked, and how it proves itself. */
export interface EntitlementInput {
    readonly identityOrigin: string;
    readonly signerEmail: string;
    readonly token: () => Promise<string>;
}

/**
 * Read the signer's entitlement from identity, riding out a cold task. The one read both assertions below judge.
 *
 * @param input - The identity origin, the signer's address (for the message), and its token source.
 * @param deps - `fetch` and the retry bound.
 * @returns `entitled` or `notEntitled`; never `unreadable`, which is thrown.
 * @throws Error When identity refuses the read, answers something that is not a profile, or stays unavailable.
 * @sideEffect Mints a token and makes one or more HTTPS reads against identity.
 */
async function readSignerEntitlement(
    input: EntitlementInput,
    deps: EntitlementDeps,
): Promise<Exclude<SignerEntitlement, { readonly kind: 'unreadable' }>> {
    const body = await requestIdentity(
        {
            identityOrigin: input.identityOrigin,
            path: '/api/v1/users/me',
            method: 'GET',
            asDescription: `the pool signer ${input.signerEmail}`,
            token: input.token,
            onOk: async (response) => (await response.json()) as unknown,
        },
        deps,
    );

    const verdict = judgeSignerEntitlement(body);

    if (verdict.kind === 'unreadable') {
        throw new Error(
            `GET ${withoutTrailingSlashes(input.identityOrigin)}/api/v1/users/me as the pool signer ${input.signerEmail}: ${verdict.reason}`,
        );
    }

    return verdict;
}

/**
 * Refuse to seed unless identity says the signer is entitled to the paid features.
 *
 * @param input - The identity origin, the signer's address (for the message), and its token source.
 * @param deps - `fetch` and the retry bound.
 * @throws SignerNotEntitledError When the signer is read and is not entitled — the fix is `poolAdmin --apply`.
 * @throws Error When identity refuses the read, answers something that is not a profile, or stays unavailable.
 * @sideEffect Mints a token and makes one or more HTTPS reads against identity.
 */
export async function assertSignerEntitled(input: EntitlementInput, deps: EntitlementDeps = {}): Promise<void> {
    const verdict = await readSignerEntitlement(input, deps);

    if (verdict.kind === 'notEntitled') {
        throw new SignerNotEntitledError(
            `e2e-seed provision: the pool signer ${input.signerEmail} is not entitled to the paid features ` +
                `(identity's account.paidFeatures is '${verdict.paidFeatures}', expected 'granted'), so the recipe ` +
                `service would refuse its private fixture recipes with 400 INVALID_VISIBILITY and every flow would ` +
                `fail in its reset. Its Clerk user is missing the roles POOL_ROSTER declares: run \`poolAdmin --apply\` ` +
                `(packages/tools/e2e-fixtures/src/poolAdmin.ts) against the sandbox tenant, then re-run.`,
            verdict.paidFeatures,
        );
    }
}

/**
 * Refuse to carry on unless identity says the signer is NOT entitled — the downgraded owner's consumers assume it.
 *
 * @param input - The identity origin, the signer's address (for the message), and a FRESH token source: a token minted
 *   before the downgrade still carries the old roles, which would make a settled owner read as entitled.
 * @param deps - `fetch` and the retry bound.
 * @throws SignerStillEntitledError When identity still reports `granted`.
 * @throws Error When identity refuses the read, answers something that is not a profile, or stays unavailable.
 * @sideEffect Mints a token and makes one or more HTTPS reads against identity.
 */
export async function assertSignerNotEntitled(input: EntitlementInput, deps: EntitlementDeps = {}): Promise<void> {
    const verdict = await readSignerEntitlement(input, deps);

    if (verdict.kind === 'entitled') {
        throw new SignerStillEntitledError(
            `e2e-seed: ${input.signerEmail} is still entitled to the paid features after it was settled ` +
                `(identity's account.paidFeatures is 'granted', expected 'upsell' or 'hidden'), so the make-public ` +
                `flows that sign in as it would not see the downgraded behaviour they assert.`,
        );
    }
}
