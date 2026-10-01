// @vitest-environment node
/**
 * Repo-wide guard: **every `rds-db:connect` grant names its database user through the registry, via CDK's own
 * `grantConnect`, and the register below says which stack may log in as which role.**
 *
 * ## Why each half
 *
 * - **`grantConnect`, never a hand-built ARN.** The one hand-built `rds-db:connect` ARN this repository had used
 *   CDK's default `SLASH_RESOURCE_NAME` format, matched no real resource, and silently denied every recipe worker
 *   (#121): 540 of 540 archive sweeps failed on a live preview, reported as `PAM authentication failed`.
 *   `IDatabaseInstance.grantConnect` builds the ARN CDK tests.
 * - **`DATABASE_ROLES.<svc>.<role>`, never a literal.** Which role a principal logs in as IS its authority under
 *   the role split (ADR-0039): the migrator may DDL as the owner, the service role may only read and write data.
 * - **The register.** A stack gaining a login is a change to who can do what to a database, so it is a reviewed
 *   line here — exact equality in both directions, like ADR-0004's NAT-consumer table: a grant the register has not
 *   heard of fails, and so does a register entry nothing grants any more.
 */
import { describe, expect, it } from 'vitest';

import { productionSources, readSource, withoutTsComments } from './roleSplitSources.js';

/**
 * Which stack logs in as which role. Schema stacks migrate (`migrator`); service, worker and webhook stacks serve
 * (`app`). Nothing logs in as an `owner` — it is NOLOGIN.
 */
const REGISTER: Readonly<Record<string, readonly string[]>> = {
    'packages/services/food-service/infra/lib/FoodSchemaStack.ts': ['DATABASE_ROLES.food.migrator'],
    'packages/services/food-service/infra/lib/FoodServiceStack.ts': ['DATABASE_ROLES.food.app'],
    'packages/services/identity-webhooks/infra/lib/WebhooksStack.ts': ['DATABASE_ROLES.identity.app'],
    'packages/services/identity/infra/lib/IdentitySchemaStack.ts': ['DATABASE_ROLES.identity.migrator'],
    'packages/services/identity/infra/lib/IdentityServiceStack.ts': ['DATABASE_ROLES.identity.app'],
    'packages/services/recipe-service/infra/lib/RecipeSchemaStack.ts': ['DATABASE_ROLES.recipe.migrator'],
    'packages/services/recipe-service/infra/lib/RecipeServiceStack.ts': ['DATABASE_ROLES.recipe.app'],
    'packages/services/recipe-workers/infra/lib/RecipeWorkersStack.ts': ['DATABASE_ROLES.recipe.app'],
};

/** What a one-argument `grantConnect(grantee)` connects as: CDK's default, the instance's MASTER user. */
const MASTER_DEFAULT = '<no user — CDK defaults to the master>';

/**
 * The database user each `grantConnect(…)` call in `source` names — its second argument, or {@link MASTER_DEFAULT}
 * when there is none.
 *
 * @param source - Source with its comments removed.
 * @returns The users, in order of appearance. Pure.
 */
function grantUsers(source: string): readonly string[] {
    return [...source.matchAll(/\.grantConnect\(([^()]*(?:\([^()]*\)[^()]*)*)\)/gu)].map((match) => {
        const args = (match[1] ?? '').split(',').map((arg) => arg.trim());

        return args.length > 1 && args[1] !== '' ? (args[1] ?? '') : MASTER_DEFAULT;
    });
}

/** Every `grantConnect` user, per file. */
function discoveredGrants(): Record<string, readonly string[]> {
    const grants: Record<string, readonly string[]> = {};

    for (const path of productionSources()) {
        const users = grantUsers(withoutTsComments(readSource(path)));

        if (users.length > 0) {
            grants[path] = [...new Set(users)].sort();
        }
    }

    return grants;
}

describe('rds-db:connect grants', () => {
    it("reads a grant's user — and a ONE-argument grant as the master default, which no register entry allows", () => {
        expect(grantUsers('database.grantConnect(role, DATABASE_ROLES.food.app);')).toEqual([
            'DATABASE_ROLES.food.app',
        ]);
        expect(grantUsers('db.grantConnect(fn)')).toEqual([MASTER_DEFAULT]);
        expect(grantUsers('db.grantConnect(fn.role())')).toEqual([MASTER_DEFAULT]);
        expect(grantUsers("db.grantConnect(x, 'food_app')")).toEqual(["'food_app'"]);
    });

    it('discovers grants — an empty scan would pass everything below', () => {
        expect(Object.keys(discoveredGrants()).length).toBeGreaterThanOrEqual(6);
    });

    it('match the register exactly: which stack logs in as which role', () => {
        expect(discoveredGrants()).toEqual(REGISTER);
    });

    it('never grant an owner role — owners are NOLOGIN', () => {
        expect(
            Object.values(discoveredGrants())
                .flat()
                .filter((user) => /\.owner$/u.test(user)),
        ).toEqual([]);
    });

    it('are never hand-built: no production file writes an rds-db ARN itself', () => {
        const handBuilt = productionSources().filter((path) =>
            /['"`]rds-db(?::connect)?['"`]|:dbuser[:/]/u.test(withoutTsComments(readSource(path))),
        );

        expect(handBuilt).toEqual([]);
    });
});
