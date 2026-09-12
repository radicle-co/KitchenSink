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
            armed: false,
        });
    });

    it('is armed only when the event token AND the deployed function’s own flag both name its STAGE', () => {
        const token = 'role-split-2026-09:prod';

        expect(
            parseBootstrapRequest(
                { service: 'identity', database: 'kitchensink_identity', legacyRecreate: token },
                { STAGE: 'prod', LEGACY_RECREATE_ARMED: token },
            ),
        ).toMatchObject({ armed: true, isProd: true });

        expect(() =>
            parseBootstrapRequest(
                { service: 'identity', database: 'kitchensink_identity', legacyRecreate: 'role-split-2026-09:sandbox' },
                { STAGE: 'prod', LEGACY_RECREATE_ARMED: token },
            ),
        ).toThrow(/legacy recreate/u);
    });

    it('⛔ refuses an ARMED event when the deployed function is not armed — a direct invoke cannot arm it', () => {
        // The token is a public string; `lambda:Invoke` in this shared account is not the authority. The function's
        // own environment — set only by a DataStack deploy of an armed stage — is.
        expect(() =>
            parseBootstrapRequest(
                { service: 'food', database: 'kitchensink_food', legacyRecreate: 'role-split-2026-09:sandbox' },
                { STAGE: 'sandbox' },
            ),
        ).toThrow(/not armed/u);
    });

    it('an armed function receiving an unarmed event runs an ordinary, unarmed pass', () => {
        expect(
            parseBootstrapRequest(
                { service: 'food', database: 'kitchensink_food' },
                { STAGE: 'sandbox', LEGACY_RECREATE_ARMED: 'role-split-2026-09:sandbox' },
            ),
        ).toMatchObject({ armed: false });
    });

    it('throws on a malformed function flag', () => {
        expect(() =>
            parseBootstrapRequest(
                { service: 'food', database: 'kitchensink_food' },
                { STAGE: 'sandbox', LEGACY_RECREATE_ARMED: 'role-split-2026-09:prod' },
            ),
        ).toThrow(/legacy recreate/u);
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
