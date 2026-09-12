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
