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
import pRetry, { AbortError } from 'p-retry';

import { userProfileSchema, type PaidFeatures } from '@kitchensink/schema-identity';

import { withoutTrailingSlashes } from './env.js';
import { isTransientStatus } from './transientStatus.js';

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
 * Judge a `GET /api/v1/users/me` body against identity's own published schema. Pure.
 *
 * @param body - The parsed response body.
 * @returns `entitled` only for `account.paidFeatures === 'granted'`.
 */
export function judgeSignerEntitlement(body: unknown): SignerEntitlement {
    const parsed = userProfileSchema.safeParse(body);

    if (!parsed.success) {
        return { kind: 'unreadable', reason: 'the body is not the profile identity publishes' };
    }

    const { paidFeatures } = parsed.data.account;

    return paidFeatures === 'granted' ? { kind: 'entitled' } : { kind: 'notEntitled', paidFeatures };
}

/** How the read rides out a cold identity task. */
export interface EntitlementRetry {
    readonly retries: number;
    readonly intervalMs: number;
}

/** Injected so the unit tier needs no network and no timers. */
export interface EntitlementDeps {
    readonly fetch?: typeof globalThis.fetch;
    readonly retry?: EntitlementRetry;
}

/** Three retries, two seconds apart: the read is idempotent, and the only thing to wait for is a task to wake. */
const DEFAULT_RETRY: EntitlementRetry = { retries: 3, intervalMs: 2_000 };

/** A status the stage recovers from on its own. Anything else is identity's answer and is final. */
class TransientIdentityFailure extends Error {
    public constructor(message: string) {
        super(message);
        this.name = 'TransientIdentityFailure';
        Object.setPrototypeOf(this, TransientIdentityFailure.prototype);
    }
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
export async function assertSignerEntitled(
    input: { readonly identityOrigin: string; readonly signerEmail: string; readonly token: () => Promise<string> },
    deps: EntitlementDeps = {},
): Promise<void> {
    const fetch = deps.fetch ?? globalThis.fetch;
    const retry = deps.retry ?? DEFAULT_RETRY;
    const url = `${withoutTrailingSlashes(input.identityOrigin)}/api/v1/users/me`;
    const asSigner = `GET ${url} as the pool signer ${input.signerEmail}`;

    const body = await pRetry(
        async () => {
            let response: Response;

            try {
                response = await fetch(url, { headers: { Authorization: `Bearer ${await input.token()}` } });
            } catch (error) {
                throw new TransientIdentityFailure(
                    `${asSigner} did not complete (${error instanceof Error ? error.message : String(error)})`,
                );
            }

            if (!response.ok) {
                const message = `${asSigner} answered ${response.status}`;

                throw isTransientStatus(response.status)
                    ? new TransientIdentityFailure(message)
                    : new AbortError(message);
            }

            try {
                return (await response.json()) as unknown;
            } catch {
                throw new AbortError(`${asSigner} answered ${response.status} with a body that is not JSON`);
            }
        },
        {
            retries: retry.retries,
            minTimeout: retry.intervalMs,
            maxTimeout: retry.intervalMs,
            shouldRetry: ({ error }) => error instanceof TransientIdentityFailure,
        },
    );

    const verdict = judgeSignerEntitlement(body);

    if (verdict.kind === 'unreadable') {
        throw new Error(`${asSigner}: ${verdict.reason}`);
    }

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
