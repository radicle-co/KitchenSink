/**
 * RESET A POOL USER'S SETTINGS — `DELETE /api/v1/users/me/settings` (ADR-0059).
 *
 * `PATCH` can choose a setting and can never un-choose it, and the deployed suites REUSE pool users: a run that left
 * `recipeViewMode = grid` on a signer changed what the next run saw (CI run 39165813897, `iossigner02`, the
 * `recipes/delete` flow). The recipe purge cannot reach it — settings live in identity — so the reset calls identity
 * itself, AS the slot, which is the only row the route can name.
 *
 * ⛔ A `404` FAILS. It is either an origin that is not identity or a server that predates the route (the first run
 * after a push races the identity deploy, `sandbox-identity-deploy.yml`), and in both cases the settings were NOT
 * reset: reading it as "nothing to reset" would turn a stale world into a green. The message says which cause to look at.
 *
 * @pattern Adapter — `settingsResetVia` fits identity's HTTP route to the one-method port the reset depends on
 */
import { remintFromSession, type SessionHandle } from '@kitchensink/e2e-fixtures';

import { isIdentityRefusedError } from './identityRefusedError.js';
import { requestIdentity, type IdentityDeps } from './identityRequest.js';
import { memoizingTokenSource } from './tokenSource.js';

/** The route, written once. */
const SETTINGS_PATH = '/api/v1/users/me/settings';

/**
 * The seam that restores a slot's settings to "never chosen". A port because the far side is identity's own route,
 * whose contract is authored in that service (ADR-0014); this package states only what a reset needs from it.
 */
export interface SettingsResetPort {
    /**
     * Delete the session's own settings row; resolves when identity answered `204` (also when there was no row).
     *
     * @sideEffect Calls identity as the handle's user.
     */
    readonly reset: (handle: SessionHandle) => Promise<void>;
}

/** Who is reset, where, and how it proves itself. */
export interface SettingsResetInput {
    readonly identityOrigin: string;
    /** The slot's address, for the message. */
    readonly subject: string;
    readonly token: () => Promise<string>;
}

/**
 * Restore one user's settings to "never chosen".
 *
 * @param input - The identity origin, the slot's address (for the message), and its token source.
 * @param deps - `fetch` and the retry bound.
 * @throws Error When identity refuses the call (a `404` says the origin or the deploy is wrong), or stays unavailable.
 * @sideEffect Mints a token and makes one or more HTTPS calls against identity.
 */
export async function resetUserSettings(input: SettingsResetInput, deps: IdentityDeps = {}): Promise<void> {
    try {
        await requestIdentity(
            {
                identityOrigin: input.identityOrigin,
                path: SETTINGS_PATH,
                method: 'DELETE',
                asDescription: input.subject,
                token: input.token,
                // A 204 has no body; nothing to read.
                onOk: async () => undefined,
            },
            deps,
        );
    } catch (error) {
        if (isIdentityRefusedError(error) && error.status === 404) {
            throw new Error(
                `${error.message} — the settings were NOT reset. Either E2E_SEED_IDENTITY_URL is not the identity ` +
                    `service, or that server predates DELETE ${SETTINGS_PATH} (is its deploy finished?)`,
                { cause: error },
            );
        }

        throw error;
    }
}

/** What {@link settingsResetVia} can have injected. */
export interface SettingsResetDeps extends IdentityDeps {
    /** A token source for a handle; the shipped one re-mints from the held Clerk session. */
    readonly token?: (handle: SessionHandle) => () => Promise<string>;
}

/**
 * The {@link SettingsResetPort} over identity's `DELETE /api/v1/users/me/settings`.
 *
 * @param identityOrigin - The stage's identity origin.
 * @param deps - Injected collaborators; the defaults are the real ones.
 * @returns The port.
 * @sideEffect The returned port's `reset` mints Clerk tokens and calls identity.
 */
export function settingsResetVia(identityOrigin: string, deps: SettingsResetDeps = {}): SettingsResetPort {
    const tokenFor =
        deps.token ?? ((handle: SessionHandle) => memoizingTokenSource(handle, { remint: remintFromSession }));

    return {
        reset: (handle) =>
            resetUserSettings(
                { identityOrigin, subject: handle.email, token: tokenFor(handle) },
                {
                    ...(deps.fetch === undefined ? {} : { fetch: deps.fetch }),
                    ...(deps.retry === undefined ? {} : { retry: deps.retry }),
                },
            ),
    };
}
