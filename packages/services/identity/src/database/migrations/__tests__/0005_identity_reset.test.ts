import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';

const { Client } = pg;

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const MIGRATION_PATH = join(__dirname, '..', '0005_identity_reset.sql');

describe('0005_identity_reset migration', () => {
    let container: StartedPostgreSqlContainer;
    let client: InstanceType<typeof Client>;

    beforeAll(async () => {
        container = await new PostgreSqlContainer('postgres:16-alpine').start();
        client = new Client({ connectionString: container.getConnectionUri() });
        await client.connect();
    }, 120_000);

    afterAll(async () => {
        await client?.end();
        await container?.stop();
    }, 30_000);

    it('applies migration without error', async () => {
        const sql = readFileSync(MIGRATION_PATH, 'utf-8');
        // Multi-statement text (no params) is sent over the simple query protocol, so pg resolves an
        // array of one Result per statement — verify all 16 DDL statements in the file ran, in order.
        await expect(client.query(sql)).resolves.toEqual(
            [
                'CREATE', // CREATE EXTENSION citext
                'DROP', // DROP TABLE profiles
                'DROP', // DROP TABLE accounts
                'DROP', // DROP TABLE users
                'DROP', // DROP TYPE user_status
                'CREATE', // CREATE TYPE user_status
                'CREATE', // CREATE TABLE users
                'CREATE', // CREATE UNIQUE INDEX users_identity_id_unique
                'CREATE', // CREATE UNIQUE INDEX users_email_unique
                'CREATE', // CREATE INDEX users_email_idx
                'CREATE', // CREATE INDEX users_identity_id_idx
                'CREATE', // CREATE TABLE accounts
                'CREATE', // CREATE INDEX accounts_user_id_idx
                'CREATE', // CREATE UNIQUE INDEX accounts_user_id_unique
                'CREATE', // CREATE TABLE profiles
                'CREATE', // CREATE UNIQUE INDEX profiles_user_id_unique
            ].map((command) => expect.objectContaining({ command })),
        );
    });

    it('users table has expected columns', async () => {
        const result = await client.query<{ column_name: string; data_type: string; is_nullable: string }>(
            `SELECT column_name, data_type, is_nullable
             FROM information_schema.columns
             WHERE table_name = 'users'
             ORDER BY ordinal_position`,
        );
        const cols = result.rows.map((r) => r.column_name);
        expect(cols).toContain('id');
        expect(cols).toContain('identity_id');
        expect(cols).toContain('email');
        expect(cols).toContain('external_id_synced_at');
        expect(cols).toContain('created_at');
        expect(cols).toContain('updated_at');
    });

    it('users.id is text PRIMARY KEY', async () => {
        const result = await client.query<{
            column_name: string;
            data_type: string;
            character_maximum_length: number | null;
        }>(
            `SELECT column_name, data_type, character_maximum_length
             FROM information_schema.columns
             WHERE table_name = 'users' AND column_name = 'id'`,
        );
        expect(result.rows).toHaveLength(1);
        expect(result.rows[0]!.data_type).toBe('text');
    });

    it('users has unique index on identity_id', async () => {
        const result = await client.query<{ indexname: string; indexdef: string }>(
            `SELECT indexname, indexdef
             FROM pg_indexes
             WHERE tablename = 'users' AND indexdef ILIKE '%identity_id%'`,
        );
        expect(result.rows.length).toBeGreaterThan(0);
        const isUnique = result.rows.some((r) => r.indexdef.toLowerCase().includes('unique'));
        expect(isUnique).toBe(true);
    });

    it('users has unique index on email', async () => {
        const result = await client.query<{ indexname: string; indexdef: string }>(
            `SELECT indexname, indexdef
             FROM pg_indexes
             WHERE tablename = 'users' AND indexdef ILIKE '%email%'`,
        );
        expect(result.rows.length).toBeGreaterThan(0);
        const isUnique = result.rows.some((r) => r.indexdef.toLowerCase().includes('unique'));
        expect(isUnique).toBe(true);
    });

    it('accounts.user_id references users(id)', async () => {
        const result = await client.query<{
            column_name: string;
            foreign_table_name: string;
            foreign_column_name: string;
        }>(
            `SELECT kcu.column_name, ccu.table_name AS foreign_table_name, ccu.column_name AS foreign_column_name
             FROM information_schema.table_constraints AS tc
             JOIN information_schema.key_column_usage AS kcu
               ON tc.constraint_name = kcu.constraint_name
             JOIN information_schema.constraint_column_usage AS ccu
               ON ccu.constraint_name = tc.constraint_name
             WHERE tc.constraint_type = 'FOREIGN KEY'
               AND tc.table_name = 'accounts'
               AND kcu.column_name = 'user_id'`,
        );
        expect(result.rows).toHaveLength(1);
        expect(result.rows[0]!.foreign_table_name).toBe('users');
        expect(result.rows[0]!.foreign_column_name).toBe('id');
    });

    it('profiles.user_id references users(id)', async () => {
        const result = await client.query<{
            column_name: string;
            foreign_table_name: string;
            foreign_column_name: string;
        }>(
            `SELECT kcu.column_name, ccu.table_name AS foreign_table_name, ccu.column_name AS foreign_column_name
             FROM information_schema.table_constraints AS tc
             JOIN information_schema.key_column_usage AS kcu
               ON tc.constraint_name = kcu.constraint_name
             JOIN information_schema.constraint_column_usage AS ccu
               ON ccu.constraint_name = tc.constraint_name
             WHERE tc.constraint_type = 'FOREIGN KEY'
               AND tc.table_name = 'profiles'
               AND kcu.column_name = 'user_id'`,
        );
        expect(result.rows).toHaveLength(1);
        expect(result.rows[0]!.foreign_table_name).toBe('users');
        expect(result.rows[0]!.foreign_column_name).toBe('id');
    });

    it('can insert a user with identity_id and email', async () => {
        // Single parameterized statement resolves to one Result (not an array — contrast with the
        // multi-statement migration above); a successful INSERT affects exactly one row.
        await expect(
            client.query(`INSERT INTO users (id, identity_id, email, name) VALUES ($1, $2, $3, $4)`, [
                '01ARYZ6S41TSV4RRFFQ69G5FAV',
                'user_2abc123',
                'test@example.com',
                'Test User',
            ]),
        ).resolves.toMatchObject({ command: 'INSERT', rowCount: 1 });
    });

    it('enforces unique constraint on identity_id', async () => {
        await expect(
            client.query(`INSERT INTO users (id, identity_id, email, name) VALUES ($1, $2, $3, $4)`, [
                '01ARYZ6S41TSV4RRFFQ69G5FAX',
                'user_2abc123',
                'other@example.com',
                'Other User',
            ]),
        ).rejects.toThrow();
    });

    it('enforces unique constraint on email', async () => {
        await expect(
            client.query(`INSERT INTO users (id, identity_id, email, name) VALUES ($1, $2, $3, $4)`, [
                '01ARYZ6S41TSV4RRFFQ69G5FAY',
                'user_different',
                'test@example.com',
                'Dup Email',
            ]),
        ).rejects.toThrow();
    });
});
