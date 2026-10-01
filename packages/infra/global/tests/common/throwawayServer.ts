/**
 * @module throwawayServer — the PostgreSQL server this package's role-split integration suites may destroy on.
 *
 * These suites CREATE and DROP roles and databases as a superuser, so the address is never `DATABASE_URL` — the
 * application's variable, which `.env.development` points at a live local database and a tunnel at a shared RDS.
 * It is `DATABASE_ADMIN_URL`, admitted by the ONE rule every integration tier uses
 * (`@kitchensink/service-test-harness`'s `decideAdminServerUrl`: loopback host, a maintenance database named).
 * Absent skips the suite; set-but-refused FAILS the run at import, because a refusal is a misconfiguration the
 * developer must see, not a green skip.
 *
 * ⚠️ These suites legitimately need the superuser — they stand up the RDS master's stand-in and inspect the catalog
 * as it — which is why they read the decided URL rather than going through a role-scoped fixture.
 */
import { NonDisposableAdminServerError, decideAdminServerUrl } from '@kitchensink/service-test-harness';

/**
 * Vet `DATABASE_ADMIN_URL` for a suite that will destroy on it. The suite reads the variable itself and gates on
 * the result, so the gate names the variable a workflow must set (`prodDeploySmokeDepth` checks that it does).
 *
 * @param adminUrl - The raw `DATABASE_ADMIN_URL`.
 * @returns The maintenance-database URL, or `undefined` when none is configured (the suite skips).
 * @throws {NonDisposableAdminServerError} when a URL is set but is not a loopback server.
 */
export function throwawayServerUrl(adminUrl: string | undefined): string | undefined {
    const decision = decideAdminServerUrl({ DATABASE_ADMIN_URL: adminUrl });

    if (decision.kind === 'refused') {
        throw new NonDisposableAdminServerError(decision.url, decision.reason);
    }

    return decision.kind === 'usable' ? decision.url : undefined;
}
