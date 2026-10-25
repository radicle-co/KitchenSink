// @vitest-environment node
/**
 * The bootstrap custom resource's request parsing — what CloudFormation sends, and what the handler refuses before
 * it opens a connection.
 */
import { describe, expect, it } from 'vitest';

import { DATABASE_ROLES } from '@kitchensink/db-schema-guard';

import { handler, parseBootstrapRequest } from '../src/db-bootstrap/handler.js';

const env = { STAGE: 'sandbox' };

describe('parseBootstrapRequest', () => {
    it('resolves the service to its registered roles and the stage to its kind', () => {
        expect(parseBootstrapRequest({ service: 'food', database: 'kitchensink_food' }, env)).toEqual({
            service: 'food',
            roles: DATABASE_ROLES.food,
            database: 'kitchensink_food',
            isProd: false,
        });
        expect(
            parseBootstrapRequest({ service: 'identity', database: 'kitchensink_identity' }, { STAGE: 'prod' }),
        ).toMatchObject({
            isProd: true,
        });
    });

    it('⛔ refuses an event that still asks for the legacy recreate, which the disarm commit removed', () => {
        // ADR-0039's one-shot recreate is gone. An event naming it is a forged invoke or a mis-wired stack, and is
        // surfaced rather than quietly run as an ordinary pass.
        expect(() =>
            parseBootstrapRequest(
                { service: 'food', database: 'kitchensink_food', legacyRecreate: 'role-split-2026-09:sandbox' },
                env,
            ),
        ).toThrow(/legacy recreate was removed/u);
    });

    it.each([
        [{ service: 'billing', database: 'kitchensink_billing' }, /service/u],
        [{ database: 'kitchensink_food' }, /service/u],
        [{ service: 'food', database: 'kitchensink_food"; DROP DATABASE x; --' }, /database/u],
        [{ service: 'food' }, /database/u],
    ])('refuses %j', (properties, message) => {
        expect(() => parseBootstrapRequest(properties, env)).toThrow(message);
    });

    it('refuses to run without a STAGE — prod-ness must never be a default', () => {
        expect(() => parseBootstrapRequest({ service: 'food', database: 'kitchensink_food' }, {})).toThrow(/STAGE/u);
    });
});

describe('handler', () => {
    it('does nothing on Delete — tearing the stack down must never drop a role or a database', async () => {
        await expect(
            handler({ RequestType: 'Delete', PhysicalResourceId: 'db-bootstrap-food', ResourceProperties: {} }),
        ).resolves.toEqual({ PhysicalResourceId: 'db-bootstrap-food' });
    });
});
