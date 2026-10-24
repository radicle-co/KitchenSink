/**
 * LOCAL e2e - the avatar round trip against a REAL PostgreSQL and a REAL (LocalStack) S3 (ADR-0064): presign, `PUT` the
 * bytes with a plain HTTP client, `PATCH { avatarKey }`, then `GET /me`.
 *
 * ⛔ WHY THIS TIER. Defect D3 was invisible to every mocked test: the SDK signed a flexible-checksum parameter into the
 * presigned query, so a plain `fetch` PUT - which is what a browser and the mobile app send - was refused with a `400`
 * and NO `avatars/` object ever existed, from any client. Only an unsigned-client PUT against a real S3 can see that.
 * The same goes for the two DB CHECKs behind `avatar_key`, which the service must satisfy in one statement.
 *
 * The object is read back through the URL `GET /me` hands out, which is the CDN URL composed from the stored key.
 * Locally the "CDN" is the LocalStack bucket itself; that the deployed distribution serves it is the deployed smoke's
 * claim, not this suite's.
 *
 * Runs as `identity_service` (ADR-0039). Needs `DATABASE_ADMIN_URL` and a LocalStack S3 (`S3_ENDPOINT`).
 */
import 'reflect-metadata';

import { CreateBucketCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { newUserId } from '@kitchensink/identity-db';
import { isOwnAvatarKey } from '@kitchensink/identity-core';
import type { BootedServiceApp } from '@kitchensink/service-test-harness';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { bootIdentityApp } from '../support/identityApp.js';
import { identityDb } from '../support/roleDb.js';

const DEV_USER = newUserId();
const BUCKET = 'identity-avatar-e2e';
const ENDPOINT = process.env['S3_ENDPOINT'] ?? process.env['AWS_ENDPOINT_URL'];

/** A tiny but real PNG header + padding: S3 stores bytes, so only the length and type matter here. */
const PNG_BYTES = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(120, 1)]);

describe('avatar upload round trip, LOCAL e2e', () => {
    let booted: BootedServiceApp;
    let pool: pg.Pool;
    let s3: S3Client;

    beforeAll(async () => {
        if (ENDPOINT === undefined) {
            throw new Error('S3_ENDPOINT (LocalStack) must be set for the LOCAL e2e tier; it never skips.');
        }

        vi.stubEnv('MEDIA_BUCKET_NAME', BUCKET);
        vi.stubEnv('S3_ENDPOINT', ENDPOINT);
        vi.stubEnv('AWS_ACCESS_KEY_ID', 'test');
        vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'test');
        vi.stubEnv('AWS_REGION', 'us-east-1');

        s3 = new S3Client({
            region: 'us-east-1',
            endpoint: ENDPOINT,
            forcePathStyle: true,
            credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
        });
        await s3.send(new CreateBucketCommand({ Bucket: BUCKET })).catch((error: { name?: string }) => {
            if (error.name !== 'BucketAlreadyOwnedByYou' && error.name !== 'BucketAlreadyExists') {
                throw error;
            }
        });

        pool = new pg.Pool({ connectionString: identityDb().appUrl, max: 2 });
        booted = await bootIdentityApp({ devAuthUserId: DEV_USER, databaseUrl: identityDb().appUrl });
    });

    afterAll(async () => {
        await booted?.close();
        await pool?.end();
        vi.unstubAllEnvs();
    });

    beforeEach(async () => {
        await identityDb().truncate();
        await pool.query(`INSERT INTO users (id, identity_id, email) VALUES ($1, $2, $3)`, [
            DEV_USER,
            `user_avatar_${DEV_USER}`,
            'avatar-e2e@example.test',
        ]);
        await pool.query(`INSERT INTO profiles (user_id, display_name, avatar_url) VALUES ($1, $2, $3)`, [
            DEV_USER,
            'Ada',
            'https://img.clerk.com/original.png',
        ]);
        await pool.query(`INSERT INTO accounts (user_id) VALUES ($1)`, [DEV_USER]);
        await clearBucket();
    });

    async function clearBucket(): Promise<void> {
        const keys = await storedKeys();

        for (const key of keys) {
            await fetch(`${ENDPOINT}/${BUCKET}/${key}`, { method: 'DELETE' });
        }
    }

    async function storedKeys(): Promise<string[]> {
        const listed = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: `avatars/${DEV_USER}/` }));

        return (listed.Contents ?? []).map((object) => object.Key ?? '').filter((key) => key !== '');
    }

    /** Presign, then PUT the bytes with a PLAIN HTTP client, exactly as a browser or the mobile app does. */
    async function upload(): Promise<{ key: string; putStatus: number }> {
        const presigned = await fetch(
            `${booted.baseUrl}/api/v1/users/me/avatar/presign?type=image/png&size=${PNG_BYTES.length}`,
            { method: 'POST' },
        );
        const { uploadUrl, key } = (await presigned.json()) as { uploadUrl: string; key: string };
        const put = await fetch(uploadUrl, {
            method: 'PUT',
            headers: { 'content-type': 'image/png' },
            body: PNG_BYTES,
        });

        return { key, putStatus: put.status };
    }

    const patchMe = (body: unknown): Promise<Response> =>
        fetch(`${booted.baseUrl}/api/v1/users/me`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
        });

    const getMe = async (): Promise<{ user: { avatarUrl: string | null } }> =>
        (await (await fetch(`${booted.baseUrl}/api/v1/users/me`)).json()) as { user: { avatarUrl: string | null } };

    it('⛔ a plain-HTTP PUT to the presigned URL succeeds and the object exists (D3)', async () => {
        const { key, putStatus } = await upload();

        expect(putStatus).toBe(200);
        expect(isOwnAvatarKey(DEV_USER, key)).toBe(true);
        expect(await storedKeys()).toEqual([key]);
    });

    it('presign -> PUT -> PATCH -> GET me: the URL is composed from the key, and the object is readable at it', async () => {
        const { key } = await upload();

        const patched = await patchMe({ avatarKey: key });
        const { user } = await getMe();

        expect(patched.status).toBe(200);
        expect(user.avatarUrl).toBe(`${ENDPOINT}/${BUCKET}/${key}`);

        const object = await fetch(user.avatarUrl ?? '');

        expect(object.status).toBe(200);
        expect(Buffer.from(await object.arrayBuffer()).equals(PNG_BYTES)).toBe(true);

        // The database holds the KEY and nothing in `avatar_url` (the XOR CHECK, satisfied in one statement).
        const { rows } = await pool.query(`SELECT avatar_key, avatar_url FROM profiles WHERE user_id = $1`, [DEV_USER]);

        expect(rows).toEqual([{ avatar_key: key, avatar_url: null }]);
    });

    it('refuses an own-prefix key whose object was never uploaded', async () => {
        const res = await patchMe({ avatarKey: `avatars/${DEV_USER}/1760000000000.png` });

        expect(res.status).toBe(400);
        expect(JSON.stringify(await res.json())).toContain('AVATAR_OBJECT_MISSING');
        // The profile still shows the Clerk picture.
        expect((await getMe()).user.avatarUrl).toBe('https://img.clerk.com/original.png');
    });

    it('a replacement deletes the superseded object and keeps the new one', async () => {
        const first = await upload();
        await patchMe({ avatarKey: first.key });
        // Keys are `{timestamp}.{ext}`; wait a tick so the second is a different object.
        await new Promise((resolve) => setTimeout(resolve, 5));
        const second = await upload();

        expect(second.key).not.toBe(first.key);
        expect((await patchMe({ avatarKey: second.key })).status).toBe(200);

        expect(await storedKeys()).toEqual([second.key]);
    });

    it('null clears the avatar: the column, every object, and the response URL', async () => {
        const { key } = await upload();
        await patchMe({ avatarKey: key });

        const cleared = await patchMe({ avatarKey: null });

        expect(cleared.status).toBe(200);
        expect(await storedKeys()).toEqual([]);
        expect((await getMe()).user.avatarUrl).toBeNull();
        const { rows } = await pool.query(`SELECT avatar_key, avatar_url FROM profiles WHERE user_id = $1`, [DEV_USER]);

        expect(rows).toEqual([{ avatar_key: null, avatar_url: null }]);
    });
});
