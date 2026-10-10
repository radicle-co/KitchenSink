import { SETTINGS_DEFAULTS } from '@kitchensink/schema-identity';
import { describe, expect, it, vi } from 'vitest';

import { ProfileServiceClient } from '../profileServiceClient.js';
import { PROFILE_STALE_TIME_MS, profileQueries, profileServiceKeys } from '../queries.js';

const BASE = 'https://identity.example.test';

describe('profileServiceKeys', () => {
    it('addresses the viewer profile with the stable ["user", "me"] key', () => {
        expect(profileServiceKeys.me).toEqual(['user', 'me']);
    });
});

describe('profileQueries(client).me()', () => {
    it('builds queryOptions keyed on profileServiceKeys.me with the shared stale time', () => {
        const client = new ProfileServiceClient({ baseUrl: BASE, token: 'tok_123' });

        const options = profileQueries(client).me();

        expect(options.queryKey).toEqual(profileServiceKeys.me);
        expect(options.staleTime).toBe(PROFILE_STALE_TIME_MS);
    });

    it('queryFn calls client.getMe() with no forced refresh by default (web policy)', async () => {
        const client = new ProfileServiceClient({ baseUrl: BASE, token: 'tok_123' });
        const getMeSpy = vi.spyOn(client, 'getMe').mockResolvedValue({ user: {}, account: {} } as never);

        const options = profileQueries(client).me();
        await options.queryFn?.({} as Parameters<NonNullable<typeof options.queryFn>>[0]);

        expect(getMeSpy).toHaveBeenCalledWith(undefined);
    });

    it('queryFn forwards { forceRefresh: true } through to client.getMe() (mobile policy)', async () => {
        const client = new ProfileServiceClient({ baseUrl: BASE, token: 'tok_123' });
        const getMeSpy = vi.spyOn(client, 'getMe').mockResolvedValue({ user: {}, account: {} } as never);

        const options = profileQueries(client).me({ forceRefresh: true });
        await options.queryFn?.({} as Parameters<NonNullable<typeof options.queryFn>>[0]);

        expect(getMeSpy).toHaveBeenCalledWith({ forceRefresh: true });
    });
});

describe('profileServiceKeys.settings', () => {
    it('has its own address, so refreshing the profile does not refetch settings', () => {
        expect(profileServiceKeys.settings).toEqual(['user', 'settings']);
        expect(profileServiceKeys.settings.slice(0, profileServiceKeys.me.length)).not.toEqual(profileServiceKeys.me);
    });
});

describe('profileQueries(client).settings()', () => {
    it('is keyed on profileServiceKeys.settings and shows the PUBLISHED defaults while the first read is in flight', () => {
        const client = new ProfileServiceClient({ baseUrl: BASE, token: 'tok_123' });

        const options = profileQueries(client).settings();

        expect(options.queryKey).toEqual(profileServiceKeys.settings);
        expect(options.placeholderData).toBe(SETTINGS_DEFAULTS);
    });

    it('queryFn reads through client.getSettings()', async () => {
        const client = new ProfileServiceClient({ baseUrl: BASE, token: 'tok_123' });
        const getSettings = vi.spyOn(client, 'getSettings').mockResolvedValue({ searchShortcut: false });

        const options = profileQueries(client).settings();
        const result = await options.queryFn?.({} as Parameters<NonNullable<typeof options.queryFn>>[0]);

        expect(getSettings).toHaveBeenCalledTimes(1);
        expect(result).toEqual({ searchShortcut: false });
    });
});
