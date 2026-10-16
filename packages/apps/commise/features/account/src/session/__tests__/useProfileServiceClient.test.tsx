/**
 * Unit tests for `useProfileServiceClient` — the shared identity-client hook both apps wrap. The apps own only what is
 * platform-bound (the origin, the 401 side effect, the Clerk token template); this hook owns the token policy and the
 * memoization, so the two cannot drift apart again.
 */
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ProfileServiceClient, TokenSource } from '../../index.js';
import { useProfileServiceClient } from '../useProfileServiceClient.js';

/** A `build` double that records the token source it was handed and answers a distinct client per call. */
function recordingBuild() {
    const sources: TokenSource[] = [];
    const build = vi.fn((token: TokenSource): ProfileServiceClient => {
        sources.push(token);

        return {} as ProfileServiceClient;
    });

    return { build, sources };
}

describe('useProfileServiceClient', () => {
    it('builds the client over a token source that mints through the session and forwards forceRefresh', async () => {
        const getToken = vi.fn(async () => 'tok');
        const { build, sources } = recordingBuild();

        renderHook(() => useProfileServiceClient({ getToken, build, template: 'commise-native' }));
        const source = sources[0] as Exclude<TokenSource, string>;

        await expect(source({ forceRefresh: true })).resolves.toBe('tok');
        expect(getToken).toHaveBeenCalledWith({ template: 'commise-native', skipCache: true });
    });

    it('builds the client once per session identity, not once per render', () => {
        const getToken = vi.fn(async () => 'tok');
        const { build } = recordingBuild();

        const { result, rerender } = renderHook(() => useProfileServiceClient({ getToken, build }));
        const first = result.current;
        rerender();

        expect(result.current).toBe(first);
        expect(build).toHaveBeenCalledTimes(1);
    });

    it('builds a new client when the session’s getToken changes', () => {
        const { build } = recordingBuild();

        const { rerender } = renderHook(({ getToken }) => useProfileServiceClient({ getToken, build }), {
            initialProps: { getToken: vi.fn(async () => 'a') },
        });
        rerender({ getToken: vi.fn(async () => 'b') });

        expect(build).toHaveBeenCalledTimes(2);
    });
});
