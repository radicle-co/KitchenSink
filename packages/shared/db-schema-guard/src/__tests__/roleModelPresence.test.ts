/**
 * `assertRoleModelPresent` — the precondition a migrate checks before its lock, `SET ROLE` or any grant names a role
 * (curated catalog plan U18). Roles are server-wide and created by the global stack's bootstrap; a migrate that ran
 * before that bootstrap would fail on its first GRANT with a message that names neither cause nor fix.
 */
import { describe, expect, it } from 'vitest';

import { DATABASE_ROLES } from '../roles/databaseRoles.js';
import { RoleModelAbsentError, assertRoleModelPresent, isRoleModelAbsentError } from '../roles/roleModelPresence.js';
import type { CatalogReader } from '../port.js';

/** A reader whose `pg_roles` holds exactly `present`. */
function readerWith(present: readonly string[]): CatalogReader {
    return {
        query: async <Row>(_sql: string, values?: unknown[]) => ({
            rows: ((values?.[0] ?? []) as string[])
                .filter((name) => present.includes(name))
                .map((rolname) => ({ rolname })) as unknown as Row[],
        }),
    };
}

const options = { label: 'Food', database: 'kitchensink_food', roles: DATABASE_ROLES.food };

describe('assertRoleModelPresent', () => {
    it('passes when every role of the database exists', async () => {
        const reader = readerWith(['food_owner', 'food_migrator', 'food_app', 'food_seeder']);

        await expect(assertRoleModelPresent(reader, options)).resolves.toBeUndefined();
    });

    it('⛔ refuses when the seeder is missing, naming it and the fix', async () => {
        const outcome = await assertRoleModelPresent(
            readerWith(['food_owner', 'food_migrator', 'food_app']),
            options,
        ).then(
            () => undefined,
            (error: unknown) => error,
        );

        expect(isRoleModelAbsentError(outcome)).toBe(true);
        expect(outcome as RoleModelAbsentError).toMatchObject({
            label: 'Food',
            database: 'kitchensink_food',
            missing: ['food_seeder'],
        });
        expect((outcome as RoleModelAbsentError).message).toMatch(/deploy the global stack/u);
    });
});
