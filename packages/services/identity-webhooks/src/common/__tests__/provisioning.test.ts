import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { describe, expect, it, vi } from 'vitest';
import { accounts, profiles } from '@kitchensink/identity-service/database/schema';

import { ensureProfileAndAccount } from '../provisioning.js';

const buildMockDb = () => {
    const onConflictDoNothing = vi.fn().mockResolvedValue(undefined);
    const values = vi.fn().mockReturnValue({ onConflictDoNothing });
    const insert = vi.fn().mockReturnValue({ values });
    const db = { insert } as unknown as PostgresJsDatabase<Record<string, never>>;

    return { db, insert, values, onConflictDoNothing };
};

describe('ensureProfileAndAccount', () => {
    it('inserts the profile and the account, both create-if-missing', async () => {
        const { db, insert, values, onConflictDoNothing } = buildMockDb();

        await ensureProfileAndAccount(db, 'usr_1', 'Ada Lovelace', 'https://img/ada.png');

        expect(insert).toHaveBeenCalledWith(profiles);
        expect(insert).toHaveBeenCalledWith(accounts);
        expect(values).toHaveBeenCalledWith({
            userId: 'usr_1',
            displayName: 'Ada Lovelace',
            avatarUrl: 'https://img/ada.png',
        });
        expect(values).toHaveBeenCalledWith({ userId: 'usr_1' });
        // Idempotent: never an unconditional upsert that could clobber user-set values.
        expect(onConflictDoNothing).toHaveBeenCalledTimes(2);
    });

    it('accepts a null avatar', async () => {
        const { db, values } = buildMockDb();

        await ensureProfileAndAccount(db, 'usr_2', '', null);

        expect(values).toHaveBeenCalledWith({ userId: 'usr_2', displayName: '', avatarUrl: null });
    });
});
