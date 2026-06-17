import { describe, expect, it } from 'vitest';

import { buildProvisionDeps } from '../provisioning.js';

describe('buildProvisionDeps', () => {
    it('wires the db handle, the identity schema, and a ULID generator', () => {
        const db = { marker: true } as never;

        const deps = buildProvisionDeps(db);

        expect(deps.db).toBe(db);
        expect(deps.schema.users).toBeDefined();
        expect(deps.schema.accounts).toBeDefined();
        expect(deps.schema.profiles).toBeDefined();
        expect(typeof deps.newUserId).toBe('function');
        // The injected generator produces a 26-char Crockford ULID (matches identity-service's newUserId).
        expect(deps.newUserId()).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    });
});
