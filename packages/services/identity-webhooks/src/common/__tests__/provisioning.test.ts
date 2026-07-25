import { describe, expect, it } from 'vitest';
import { users, accounts, profiles } from '@kitchensink/identity-db';

import { buildProvisionDeps } from '../provisioning.js';

describe('buildProvisionDeps', () => {
    it('wires the db handle, the identity schema, and a ULID generator', () => {
        const db = { marker: true } as never;

        const deps = buildProvisionDeps(db);

        expect(deps.db).toBe(db);
        // Same schema table objects the service's Drizzle DAOs use, not just any table.
        expect(deps.schema.users).toBe(users);
        expect(deps.schema.accounts).toBe(accounts);
        expect(deps.schema.profiles).toBe(profiles);
        expect(typeof deps.newUserId).toBe('function');
        // The injected generator produces a 26-char Crockford ULID (matches identity-service's newUserId).
        expect(deps.newUserId()).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    });
});
