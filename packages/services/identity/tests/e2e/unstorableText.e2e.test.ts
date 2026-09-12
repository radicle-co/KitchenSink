/**
 * LOCAL e2e — a NUL (U+0000) in the viewer's display name is the caller's `400`, not a `500`, against a REAL
 * PostgreSQL. Boots the real identity app as `identity_service` (ADR-0039) with the dev-auth bypass, so the request
 * reaches the real `UsersService` and the real `UPDATE`. Target: LOCAL (§7.1a).
 *
 * ⛔ THE DEFECT: PostgreSQL `text` cannot hold a NUL, so `PATCH /api/v1/users/me` passed the schema, failed at the
 * bind with SQLSTATE `22021`, and answered `500` with a Sentry issue — on the service every request touches. The
 * filter now answers identity's `BAD_REQUEST` (`normalizeUnstorableText`); the filter integration test proves the
 * Sentry half with the database mocked.
 */
import 'reflect-metadata';

import { newUserId } from '@kitchensink/identity-db';
import { apiErrorSchema } from '@kitchensink/schema-identity';
import type { BootedServiceApp } from '@kitchensink/service-test-harness';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { identityDb } from '../support/roleDb.js';
import { bootIdentityApp } from '../support/identityApp.js';

const DEV_USER = newUserId();

/** The display name the viewer already has, which a refused write must leave in place. */
const STORED_NAME = 'Ada';

/** The caller's text around the NUL, which must never come back in an error body. */
const CALLER_TEXT = 'Ada Lovelace';

describe('a NUL in the display name answers 400, LOCAL e2e', () => {
    let booted: BootedServiceApp;
    let pool: pg.Pool;

    /** PATCH the viewer's profile. */
    function patchMe(body: Record<string, unknown>): Promise<Response> {
        return fetch(`${booted.baseUrl}/api/v1/users/me`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
        });
    }

    /** The display name the profile row holds now. */
    async function storedName(): Promise<string | undefined> {
        const { rows } = await pool.query<{ display_name: string }>(
            'SELECT display_name FROM profiles WHERE user_id = $1',
            [DEV_USER],
        );

        return rows[0]?.display_name;
    }

    beforeAll(async () => {
        pool = new pg.Pool({ connectionString: identityDb().appUrl, max: 2 });
        booted = await bootIdentityApp({ devAuthUserId: DEV_USER, databaseUrl: identityDb().appUrl });
    });

    afterAll(async () => {
        await booted?.close();
        await pool?.end();
    });

    beforeEach(async () => {
        await identityDb().truncate();
        // The dev bypass resolves the principal without the read-through, so the viewer's rows are seeded here.
        await pool.query(`INSERT INTO users (id, identity_id, email) VALUES ($1, $2, $3)`, [
            DEV_USER,
            `user_nul_${DEV_USER}`,
            'nul-e2e@example.test',
        ]);
        await pool.query(`INSERT INTO profiles (user_id, display_name) VALUES ($1, $2)`, [DEV_USER, STORED_NAME]);
        await pool.query(`INSERT INTO accounts (user_id) VALUES ($1)`, [DEV_USER]);
    });

    it('⛔ refuses a NUL with 400 BAD_REQUEST, echoes nothing, and leaves the stored name unchanged', async () => {
        const response = await patchMe({ displayName: `${CALLER_TEXT}\u0000` });
        const text = await response.text();
        const envelope = apiErrorSchema.parse(JSON.parse(text));

        expect(response.status).toBe(400);
        expect(envelope.code).toBe('BAD_REQUEST');
        expect(envelope.details?.['fields']).toEqual([envelope.message]);
        expect(text).not.toContain(CALLER_TEXT);
        expect(text).not.toContain('update');
        expect(await storedName()).toBe(STORED_NAME);
    });

    it('serves the next rename on the same app, so the refused statement left the pool clean', async () => {
        await patchMe({ displayName: `${CALLER_TEXT}\u0000` });

        const response = await patchMe({ displayName: CALLER_TEXT });

        expect(response.status).toBe(200);
        expect(await storedName()).toBe(CALLER_TEXT);
    });
});
