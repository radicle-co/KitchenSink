// @vitest-environment node
/**
 * Repo-wide guard: **a database role is named in ONE place** — `DATABASE_ROLES` / `RDS_MASTER_USERNAME` in
 * `@kitchensink/db-schema-guard` — and every production file that needs one imports it.
 *
 * ## Why
 *
 * The role split (ADR-0039) gives each database three roles, and which one a principal logs in as IS its
 * authority: a service pool that says `food_migrator` instead of `food_app` runs with DDL, a runner that says
 * `food_app` cannot migrate, and a stack that grants `rds-db:connect` to a name no bootstrap created grants
 * nothing. Before the split, `'food_app'` and `'recipe_app'` were spelled out in eleven production files; a
 * rename, or the split itself, has to find every one — and a missed one fails at a login in a deployed stage,
 * not at a compile.
 *
 * ⛔ The role names are READ from the registry, never restated here — a copy of the list could not detect that the
 * registry grew.
 */
import { describe, expect, it } from 'vitest';

import { DATABASE_ROLES, RDS_MASTER_USERNAME } from '@kitchensink/db-schema-guard';

import { productionSources, readSource, withoutTsComments } from './roleSplitSources.js';

/** The one file allowed to spell the names out. */
const REGISTRY = 'packages/shared/db-schema-guard/src/roles/databaseRoles.ts';

const ROLE_NAMES = [
    ...new Set([...Object.values(DATABASE_ROLES).flatMap((roles) => Object.values(roles)), RDS_MASTER_USERNAME]),
];

/** A role name as a whole string literal — `'food_app'`, `"food_app"` or `` `food_app` ``. */
const LITERAL = new RegExp(`(['"\`])(${ROLE_NAMES.join('|')})\\1`, 'gu');

describe('database role names live only in the registry', () => {
    it('reads a non-trivial registry — a vacuous name list would pass everything below', () => {
        expect(ROLE_NAMES.length).toBeGreaterThanOrEqual(10);
    });

    it('no production file spells a role name as a string literal', () => {
        const offenders = productionSources()
            .filter((path) => path !== REGISTRY)
            .flatMap((path) =>
                [...withoutTsComments(readSource(path)).matchAll(LITERAL)].map((match) => `${path}: ${match[0]}`),
            );

        expect(offenders).toEqual([]);
    });
});
