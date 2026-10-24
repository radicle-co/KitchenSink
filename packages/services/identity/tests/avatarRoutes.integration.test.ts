/**
 * Integration (mocked `pg` and SQS): the avatar HTTP surface of the REAL identity app (ADR-0064).
 *
 *  - `POST /api/v1/users/me/avatar/presign` answers `{ uploadUrl, key }` - a key under the caller's own prefix and a URL
 *    that carries no flexible-checksum parameter (D3) - and refuses a bad type or size with a `400` before signing.
 *  - `PATCH /api/v1/users/me { avatarKey }` refuses a key that is not the caller's with a `400` naming the code, BEFORE
 *    any database read, and the retired `avatarUrl` field with a `400`.
 *
 * The real S3 round trip (presign, PUT, PATCH, GET) is the LOCAL e2e tier's job (`avatarUpload.e2e.test.ts`): this tier
 * mocks every dependency, and presigning needs no network.
 */
import 'reflect-metadata';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { avatarKeyPrefix, isOwnAvatarKey } from '@kitchensink/identity-core';
import type { ApiErrorBody } from '@kitchensink/schema-identity';

vi.mock('pg', () => {
    class Pool {
        connect = vi.fn();
        query = vi.fn();
        end = vi.fn();
        on = vi.fn();
    }

    return { default: { Pool } };
});

vi.mock('@aws-sdk/client-sqs', () => ({
    SQSClient: vi.fn(),
    SendMessageCommand: vi.fn(),
}));

import type { BootedServiceApp } from '@kitchensink/service-test-harness';

import { bootIdentityApp } from './support/identityApp.js';

const DEV_USER = '01HZZE2EAVATARUSER00000000';
const OTHER_USER = '01HZZE2EAVATAROTHER0000000';

describe('avatar routes (mocked dependencies)', () => {
    let booted: BootedServiceApp;

    beforeAll(async () => {
        vi.stubEnv('MEDIA_BUCKET_NAME', 'integration-media-bucket');
        vi.stubEnv('AWS_ACCESS_KEY_ID', 'test');
        vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'test');
        vi.stubEnv('AWS_REGION', 'us-east-1');
        booted = await bootIdentityApp({ devAuthUserId: DEV_USER });
    });

    afterAll(async () => {
        await booted?.close();
        vi.unstubAllEnvs();
    });

    const presign = (query: string): Promise<Response> =>
        fetch(`${booted.baseUrl}/api/v1/users/me/avatar/presign?${query}`, { method: 'POST' });

    const patchMe = async (body: unknown): Promise<{ status: number; envelope: ApiErrorBody }> => {
        const res = await fetch(`${booted.baseUrl}/api/v1/users/me`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
        });

        return { status: res.status, envelope: (await res.json()) as ApiErrorBody };
    };

    describe('POST /me/avatar/presign', () => {
        it('answers { uploadUrl, key }: an own-prefix key, a bucket URL, and no checksum parameter', async () => {
            const res = await presign('type=image/png&size=1024');
            const body = (await res.json()) as { uploadUrl: string; key: string; publicUrl?: string };

            expect(res.status).toBe(200);
            expect(Object.keys(body).sort()).toEqual(['key', 'uploadUrl']);
            expect(body.key.startsWith(avatarKeyPrefix(DEV_USER))).toBe(true);
            expect(isOwnAvatarKey(DEV_USER, body.key)).toBe(true);

            const url = new URL(body.uploadUrl);

            expect(url.pathname.endsWith(body.key) || url.hostname.startsWith('integration-media-bucket')).toBe(true);
            expect([...url.searchParams.keys()].filter((name) => name.toLowerCase().includes('checksum'))).toEqual([]);
        });

        it.each([
            ['an unsupported type', 'type=image/gif&size=1024'],
            ['an oversize file', `type=image/png&size=${5 * 1024 * 1024 + 1}`],
            ['a non-numeric size', 'type=image/png&size=abc'],
            ['no size', 'type=image/png'],
        ])('refuses %s with 400 before signing anything', async (_name, query) => {
            const res = await presign(query);

            expect(res.status).toBe(400);
        });
    });

    describe('PATCH /me { avatarKey }', () => {
        it.each([
            ['another user’s key', `avatars/${OTHER_USER}/1760000000000.png`],
            ['a recipe photo', `recipes/${DEV_USER}/photo.png`],
            ['a traversal', `avatars/${DEV_USER}/../${OTHER_USER}/1.png`],
        ])('refuses %s with 400 AVATAR_KEY_NOT_OWNED, before any database read', async (_name, avatarKey) => {
            const { status, envelope } = await patchMe({ avatarKey });

            expect(status).toBe(400);
            expect(JSON.stringify(envelope)).toContain('AVATAR_KEY_NOT_OWNED');
        });

        it('refuses the retired avatarUrl field with 400', async () => {
            const { status, envelope } = await patchMe({ avatarUrl: 'https://evil.example/x.png' });

            expect(status).toBe(400);
            expect(envelope.code).toBe('BAD_REQUEST');
        });
    });
});
