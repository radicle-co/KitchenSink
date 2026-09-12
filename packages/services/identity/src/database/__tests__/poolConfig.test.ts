import { describe, expect, it, vi } from 'vitest';

const signedFor = vi.fn();

vi.mock('@aws-sdk/rds-signer', () => ({
    Signer: vi.fn(function fakeSigner(options: { username: string }) {
        signedFor(options.username);

        return { getAuthToken: (): Promise<string> => Promise.resolve('token') };
    }),
}));

const { identityPoolConfig } = await import('../poolConfig.js');

describe('identityPoolConfig — who the identity service connects as', () => {
    const discrete = { DB_HOST: 'db.internal', DB_PORT: '5432', DB_NAME: 'kitchensink_identity', STAGE: 'sandbox' };

    it('⛔ connects as identity_service by RDS IAM — never as the master it used to run as', () => {
        // The service connected with the RDS MASTER's password (`identity_app`, rds_superuser) behind a public
        // ALB. The role split gives it its own login with data privileges only.
        const config = identityPoolConfig(discrete);

        expect(config.user).toBe('identity_service');
        expect(typeof config.password).toBe('function');
        expect(signedFor).toHaveBeenCalledWith('identity_service');
        expect(signedFor).not.toHaveBeenCalledWith('identity_app');
    });

    it('needs no DB_PASSWORD on a deployed stage — there is no password to read', () => {
        expect(() => identityPoolConfig(discrete)).not.toThrow();
    });

    it('still honours DATABASE_URL for local development and the harnesses', () => {
        expect(identityPoolConfig({ DATABASE_URL: 'postgresql://identity:identity@localhost:5432/x' })).toEqual({
            connectionString: 'postgresql://identity:identity@localhost:5432/x',
        });
    });

    it('fails naming the variable when the discrete form is incomplete', () => {
        expect(() => identityPoolConfig({ DB_PORT: '5432', DB_NAME: 'x' })).toThrow(/DB_HOST/u);
    });
});
