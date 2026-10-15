import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

const IDP_API_BASE = 'https://api.clerk.com/v1';

let lastPatchBody: Record<string, unknown> | null = null;
let lastPatchUserId: string | null = null;
let lastGetUserId: string | null = null;
let lastDeleteUserId: string | null = null;

const mockUserBase = {
    object: 'user',
    id: 'user_abc123',
    external_id: null,
    email_addresses: [],
    phone_numbers: [],
    web3_wallets: [],
    external_accounts: [],
    saml_accounts: [],
    password_enabled: false,
    totp_enabled: false,
    backup_code_enabled: false,
    two_factor_enabled: false,
    banned: false,
    locked: false,
    created_at: 0,
    updated_at: 0,
    image_url: '',
    has_image: false,
    first_name: 'Test',
    last_name: 'User',
    public_metadata: {},
    private_metadata: {},
    unsafe_metadata: {},
};

const server = setupServer(
    http.patch(`${IDP_API_BASE}/users/:userId`, async ({ params, request }) => {
        lastPatchUserId = params.userId as string;
        lastPatchBody = (await request.json()) as Record<string, unknown>;

        return HttpResponse.json({ ...mockUserBase, id: lastPatchUserId, external_id: lastPatchBody.external_id });
    }),

    http.get(`${IDP_API_BASE}/users/:userId`, ({ params }) => {
        lastGetUserId = params.userId as string;

        return HttpResponse.json({ ...mockUserBase, id: lastGetUserId });
    }),

    http.delete(`${IDP_API_BASE}/users/:userId`, ({ params }) => {
        lastDeleteUserId = params.userId as string;

        return HttpResponse.json({ id: params.userId, deleted: true, object: 'user' });
    }),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
    server.resetHandlers();
    lastPatchBody = null;
    lastPatchUserId = null;
    lastGetUserId = null;
    lastDeleteUserId = null;
    vi.resetModules();
});
afterAll(() => server.close());

beforeEach(() => {
    process.env['IDP_SECRET_KEY'] = 'sk_test_fake_key_for_testing';
});

describe('identity backend client', () => {
    describe('setExternalId', () => {
        it('issues PATCH /users/{id} with externalId', async () => {
            const { setExternalId } = await import('../identityClient.js');

            await setExternalId('user_abc123', 'ext_ulid_01');

            expect(lastPatchUserId).toBe('user_abc123');
            expect(lastPatchBody).toMatchObject({ external_id: 'ext_ulid_01' });
        });

        it('resolves without error on success', async () => {
            const { setExternalId } = await import('../identityClient.js');

            await expect(setExternalId('user_abc123', 'ext_ulid_01')).resolves.toBeUndefined();
        });

        it('throws on non-2xx response', async () => {
            server.use(
                http.patch(`${IDP_API_BASE}/users/:userId`, () => {
                    return HttpResponse.json(
                        { errors: [{ code: 'not_found', message: 'Not found', long_message: 'Not found' }] },
                        { status: 404 },
                    );
                }),
            );

            const { setExternalId } = await import('../identityClient.js');

            await expect(setExternalId('user_missing', 'ext_ulid_01')).rejects.toThrow();
        });
    });

    describe('getUser', () => {
        it('issues GET /users/{id} and returns user', async () => {
            const { getUser } = await import('../identityClient.js');

            const user = await getUser('user_abc123');

            expect(lastGetUserId).toBe('user_abc123');
            expect(user).toMatchObject({ id: 'user_abc123' });
        });
    });

    /**
     * The sign-up role writer (plan 2026-10-14-009 D10): `default` is WRITTEN at sign-up (owner ruling 2026-10-13),
     * but only where nothing is written — a pool user created by `poolAdmin` arrives with its roles already set.
     */
    describe('ensureDefaultRole', () => {
        const withMetadata = (publicMetadata: Record<string, unknown>): void => {
            server.use(
                http.get(`${IDP_API_BASE}/users/:userId`, ({ params }) => {
                    lastGetUserId = params.userId as string;

                    return HttpResponse.json({ ...mockUserBase, id: lastGetUserId, public_metadata: publicMetadata });
                }),
            );
        };

        let metadataPatches: { readonly userId: string; readonly body: Record<string, unknown> }[] = [];

        beforeEach(() => {
            metadataPatches = [];
            server.use(
                http.patch(`${IDP_API_BASE}/users/:userId/metadata`, async ({ params, request }) => {
                    const body = (await request.json()) as Record<string, unknown>;
                    metadataPatches.push({ userId: params.userId as string, body });

                    return HttpResponse.json({ ...mockUserBase, id: params.userId, public_metadata: body });
                }),
            );
        });

        it('merges exactly { roles: ["default"] } into a user with no roles key, reading the user fresh', async () => {
            withMetadata({ testPrincipal: true });
            const { ensureDefaultRole } = await import('../identityClient.js');

            await expect(ensureDefaultRole('user_new')).resolves.toBe('written');

            expect(lastGetUserId).toBe('user_new');
            expect(metadataPatches).toStrictEqual([
                { userId: 'user_new', body: { public_metadata: { roles: ['default'] } } },
            ]);
        });

        it.each([
            ['a premium pool user', { roles: ['premium'], testPrincipal: true }],
            ['an explicitly empty list', { roles: [] }],
            ['a malformed value an admin wrote', { roles: 'vip' }],
        ])('never overwrites %s', async (_label, publicMetadata) => {
            withMetadata(publicMetadata);
            const { ensureDefaultRole } = await import('../identityClient.js');

            await expect(ensureDefaultRole('user_has_roles')).resolves.toBe('present');

            expect(metadataPatches).toStrictEqual([]);
        });

        /** A user deleted before the delivery: converge, or svix retries a delivery that can never succeed. */
        it('answers absent, and writes nothing, for a user Clerk no longer holds (404)', async () => {
            server.use(
                http.get(`${IDP_API_BASE}/users/:userId`, () =>
                    HttpResponse.json({ errors: [{ code: 'resource_not_found', message: 'gone' }] }, { status: 404 }),
                ),
            );
            const { ensureDefaultRole } = await import('../identityClient.js');

            await expect(ensureDefaultRole('user_gone')).resolves.toBe('absent');
            expect(metadataPatches).toStrictEqual([]);
        });

        it('answers absent when the user is deleted between the read and the write (404 on the merge)', async () => {
            withMetadata({});
            server.use(
                http.patch(`${IDP_API_BASE}/users/:userId/metadata`, () =>
                    HttpResponse.json({ errors: [{ code: 'resource_not_found', message: 'gone' }] }, { status: 404 }),
                ),
            );
            const { ensureDefaultRole } = await import('../identityClient.js');

            await expect(ensureDefaultRole('user_gone_mid')).resolves.toBe('absent');
        });

        it('throws when Clerk cannot be read, and writes nothing', async () => {
            server.use(
                http.get(`${IDP_API_BASE}/users/:userId`, () =>
                    HttpResponse.json({ errors: [{ code: 'internal', message: 'down' }] }, { status: 503 }),
                ),
            );
            const { ensureDefaultRole } = await import('../identityClient.js');

            await expect(ensureDefaultRole('user_new')).rejects.toThrow();
            expect(metadataPatches).toStrictEqual([]);
        });

        it('throws when the metadata write fails', async () => {
            withMetadata({});
            server.use(
                http.patch(`${IDP_API_BASE}/users/:userId/metadata`, () =>
                    HttpResponse.json({ errors: [{ code: 'internal', message: 'down' }] }, { status: 500 }),
                ),
            );
            const { ensureDefaultRole } = await import('../identityClient.js');

            await expect(ensureDefaultRole('user_new')).rejects.toThrow();
        });
    });

    describe('deleteUser', () => {
        it('issues DELETE /users/{id}', async () => {
            const { deleteUser } = await import('../identityClient.js');

            await deleteUser('user_abc123');

            expect(lastDeleteUserId).toBe('user_abc123');
        });

        it('resolves without error on success', async () => {
            const { deleteUser } = await import('../identityClient.js');

            await expect(deleteUser('user_abc123')).resolves.toBeUndefined();
        });
    });
});
