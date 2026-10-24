/**
 * `UsersService` and the avatar KEY (ADR-0064): `PATCH /me { avatarKey }` is authorized and verified before it is
 * stored, the response URL is COMPOSED from the stored key and the CDN host, and a replacement or clear removes the
 * superseded objects and purges the edge.
 *
 * | Requirement                                                                  | Test                                         |
 * | ---------------------------------------------------------------------------- | -------------------------------------------- |
 * | a caller may point only at an object under their OWN prefix                  | 'refuses a key it does not own'              |
 * | the object must exist (HEAD)                                                 | 'refuses a key whose object is not there'    |
 * | the write sets the key AND clears the Clerk URL in one statement             | 'stores the key and clears the Clerk URL'    |
 * | `null` clears both columns                                                   | 'null clears the avatar'                     |
 * | `avatarUrl` in the response is composed from the key, else the Clerk URL     | 'composes avatarUrl'                         |
 * | superseded objects are removed AFTER the commit; failure is logged, not fatal| 'removes superseded objects'                 |
 */
import { BadRequestException } from '@nestjs/common';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { describe, expect, it, vi } from 'vitest';

import type { AvatarMediaPort } from '../src/users/avatarMedia.js';
import type { SqsService } from '../src/queue/sqs.service.js';
import { noopHandleSyncPublisher } from '../src/users/handleSync.publisher.js';
import type { ResolveUserService } from '../src/users/resolveUser.js';
import { UsersService } from '../src/users/users.service.js';
import type { AuthorizerContext } from '../src/types/jwt.js';

const USER_ID = '01J9ZK8N7QF3B2X4M6T0V5C1AB';
const OTHER_ID = '01J9ZK8N7QF3B2X4M6T0V5C1AC';
const CDN = 'https://media.commise.app';
const OWN_KEY = `avatars/${USER_ID}/1760000000000.png`;
const STAMPED = new Date('2026-01-02T03:04:05.678Z');

const CTX = { userId: USER_ID, roles: [] } as unknown as AuthorizerContext;
const EXISTING = [{ id: USER_ID, email: 'a@b.com', status: 'active', createdAt: new Date(), updatedAt: new Date() }];
const ACCOUNT = [{ id: 'acc-1', userId: USER_ID, createdAt: new Date(), updatedAt: new Date() }];

const profileRow = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    displayName: 'Ada',
    avatarUrl: null,
    avatarKey: null,
    username: 'ada',
    updatedAt: STAMPED,
    ...overrides,
});

/** A chainable Drizzle fake (see `patchUserHandleSync.test.ts`): reads in order, `returning` in order, `set` captured. */
function fakeDb(reads: unknown[][], returning: unknown[][]): { db: NodePgDatabase; sets: Record<string, unknown>[] } {
    let read = 0;
    let returned = 0;
    const sets: Record<string, unknown>[] = [];
    const selectChain = {
        from: () => selectChain,
        where: () => selectChain,
        limit: () => Promise.resolve(reads[read++] ?? []),
    };
    const update = () => ({
        set: (values: Record<string, unknown>) => {
            sets.push(values);

            const where = Promise.resolve(undefined) as Promise<undefined> & { returning: () => Promise<unknown[]> };
            where.returning = () => Promise.resolve(returning[returned++] ?? []);

            return { where: () => where };
        },
    });

    return { db: { select: () => selectChain, update } as unknown as NodePgDatabase, sets };
}

function media(overrides: Partial<AvatarMediaPort> = {}): AvatarMediaPort {
    return {
        cdnUrl: CDN,
        presignUpload: vi.fn(),
        exists: vi.fn().mockResolvedValue(true),
        removeSuperseded: vi.fn().mockResolvedValue(undefined),
        removeAll: vi.fn().mockResolvedValue(undefined),
        ...overrides,
    };
}

function service(db: NodePgDatabase, avatarMedia: AvatarMediaPort): UsersService {
    return new UsersService(
        db,
        {} as unknown as SqsService,
        {} as unknown as ResolveUserService,
        noopHandleSyncPublisher,
        avatarMedia,
        false,
    );
}

describe('patchUserMe { avatarKey }', () => {
    it.each([
        ['another user’s key', `avatars/${OTHER_ID}/1.png`],
        ['a recipe photo', `recipes/${USER_ID}/1.png`],
        ['a traversal', `avatars/${USER_ID}/../${OTHER_ID}/1.png`],
        ['a nested path', `avatars/${USER_ID}/a/1.png`],
        ['an absolute URL', `${CDN}/avatars/${USER_ID}/1.png`],
    ])('refuses a key it does not own: %s', async (_name, key) => {
        const { db, sets } = fakeDb([EXISTING, ACCOUNT], [[profileRow()]]);
        const m = media();

        await expect(service(db, m).patchUserMe(CTX, { avatarKey: key })).rejects.toBeInstanceOf(BadRequestException);

        expect(sets).toEqual([]);
        // An ownership refusal costs no S3 call at all.
        expect(m.exists).not.toHaveBeenCalled();
    });

    it('refuses a key whose object is not there (the upload never happened)', async () => {
        const { db, sets } = fakeDb([EXISTING, ACCOUNT], [[profileRow()]]);
        const m = media({ exists: vi.fn().mockResolvedValue(false) });

        await expect(service(db, m).patchUserMe(CTX, { avatarKey: OWN_KEY })).rejects.toBeInstanceOf(
            BadRequestException,
        );

        expect(m.exists).toHaveBeenCalledWith(OWN_KEY);
        expect(sets).toEqual([]);
    });

    it('lets an S3 failure surface as an error rather than reading it as "not there"', async () => {
        const { db, sets } = fakeDb([EXISTING, ACCOUNT], [[profileRow()]]);
        const m = media({ exists: vi.fn().mockRejectedValue(new Error('s3 down')) });

        await expect(service(db, m).patchUserMe(CTX, { avatarKey: OWN_KEY })).rejects.toThrow('s3 down');
        expect(sets).toEqual([]);
    });

    it('stores the key and clears the Clerk URL in one statement (the XOR check)', async () => {
        const { db, sets } = fakeDb([EXISTING, ACCOUNT], [[profileRow({ avatarKey: OWN_KEY })]]);

        await service(db, media()).patchUserMe(CTX, { avatarKey: OWN_KEY });

        expect(sets).toHaveLength(1);
        expect(sets[0]).toMatchObject({ avatarKey: OWN_KEY, avatarUrl: null });
    });

    it('composes avatarUrl in the response from the key and the CDN host', async () => {
        const { db } = fakeDb([EXISTING, ACCOUNT], [[profileRow({ avatarKey: OWN_KEY })]]);

        const result = await service(db, media()).patchUserMe(CTX, { avatarKey: OWN_KEY });

        expect(result.user.avatarUrl).toBe(`${CDN}/${OWN_KEY}`);
    });

    it('removes superseded objects AFTER the write, keeping the new key', async () => {
        const { db } = fakeDb([EXISTING, ACCOUNT], [[profileRow({ avatarKey: OWN_KEY })]]);
        const m = media();

        await service(db, m).patchUserMe(CTX, { avatarKey: OWN_KEY });

        expect(m.removeSuperseded).toHaveBeenCalledWith(USER_ID, OWN_KEY);
        expect(m.removeAll).not.toHaveBeenCalled();
    });

    it('does not fail the save when removing superseded objects fails (the new avatar is already stored)', async () => {
        const { db } = fakeDb([EXISTING, ACCOUNT], [[profileRow({ avatarKey: OWN_KEY })]]);
        const m = media({ removeSuperseded: vi.fn().mockRejectedValue(new Error('cloudfront down')) });

        await expect(service(db, m).patchUserMe(CTX, { avatarKey: OWN_KEY })).resolves.toMatchObject({
            user: { avatarUrl: `${CDN}/${OWN_KEY}` },
        });
    });

    it('null clears the avatar: both columns, every object, no existence check', async () => {
        const { db, sets } = fakeDb([EXISTING, ACCOUNT], [[profileRow()]]);
        const m = media();

        const result = await service(db, m).patchUserMe(CTX, { avatarKey: null });

        expect(sets[0]).toMatchObject({ avatarKey: null, avatarUrl: null });
        expect(m.exists).not.toHaveBeenCalled();
        expect(m.removeAll).toHaveBeenCalledWith(USER_ID);
        expect(result.user.avatarUrl).toBeNull();
    });

    it('does not fail the clear when removing the objects fails', async () => {
        const { db } = fakeDb([EXISTING, ACCOUNT], [[profileRow()]]);
        const m = media({ removeAll: vi.fn().mockRejectedValue(new Error('s3 down')) });

        await expect(service(db, m).patchUserMe(CTX, { avatarKey: null })).resolves.toBeDefined();
    });

    it('touches no storage when the PATCH carries no avatarKey', async () => {
        const { db, sets } = fakeDb([EXISTING, ACCOUNT], [[profileRow()]]);
        const m = media();

        await service(db, m).patchUserMe(CTX, { displayName: 'Ada' });

        expect(sets[0]).not.toHaveProperty('avatarKey');
        expect(sets[0]).not.toHaveProperty('avatarUrl');
        expect(m.exists).not.toHaveBeenCalled();
        expect(m.removeAll).not.toHaveBeenCalled();
        expect(m.removeSuperseded).not.toHaveBeenCalled();
    });
});

describe('avatarUrl composition on read', () => {
    it.each([
        ['a stored key is served from the CDN', { avatarKey: OWN_KEY, avatarUrl: null }, `${CDN}/${OWN_KEY}`],
        [
            'no key falls back to the Clerk picture',
            { avatarKey: null, avatarUrl: 'https://img.clerk.com/a.png' },
            'https://img.clerk.com/a.png',
        ],
        ['neither is null', { avatarKey: null, avatarUrl: null }, null],
    ])('getUserMe: %s', async (_name, columns, expected) => {
        const { db } = fakeDb([[profileRow(columns)]], []);
        const resolver = {
            resolveUser: vi.fn().mockResolvedValue({
                user: { id: USER_ID, email: 'a@b.com', status: 'active', createdAt: new Date(), updatedAt: new Date() },
                account: { id: 'acc-1', userId: USER_ID, createdAt: new Date(), updatedAt: new Date() },
            }),
        };

        const result = await new UsersService(
            db,
            {} as unknown as SqsService,
            resolver as unknown as ResolveUserService,
            noopHandleSyncPublisher,
            media(),
            false,
        ).getUserMe(CTX);

        expect(result.user.avatarUrl).toBe(expected);
    });

    it('a row from before the column existed (avatarKey undefined) still composes the Clerk URL', async () => {
        const { db } = fakeDb(
            [EXISTING, ACCOUNT],
            [[profileRow({ avatarKey: undefined, avatarUrl: 'https://img.clerk.com/a.png' })]],
        );

        const result = await service(db, media()).patchUserMe(CTX, { displayName: 'Ada' });

        expect(result.user.avatarUrl).toBe('https://img.clerk.com/a.png');
    });
});
