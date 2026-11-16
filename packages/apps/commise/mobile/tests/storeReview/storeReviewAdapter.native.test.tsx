/**
 * The only code that talks to `expo-store-review` (plan 0011 KTD5, KTD6; S52). The module is injected, so these cases
 * need no `vi.mock` and no casts. A top-level static import of the module is a mutant no unit test can see: the U5
 * device step (an old dev client built without the module) covers it.
 */
import { STORE_REVIEW_REQUESTED_EVENT } from '@commise/features-cooking/mobile';
import { describe, expect, it, vi } from 'vitest';

import { createStoreReviewAdapter, isStoreReviewUnavailableError } from '../../src/storeReview/storeReviewAdapter';

function setup(platform: 'ios' | 'android', module: { available?: boolean; requestError?: Error; loadError?: Error }) {
    const isAvailableAsync = vi.fn(() => Promise.resolve(module.available ?? true));
    const requestReview = vi.fn(() => (module.requestError ? Promise.reject(module.requestError) : Promise.resolve()));
    // Wider than the adapter's dependency surface on purpose: the adapter must call neither.
    const hasAction = vi.fn(() => Promise.resolve(true));
    const storeUrl = vi.fn(() => 'https://example.test/store');
    const reportError = vi.fn();
    const track = vi.fn();
    const load = vi.fn(() =>
        module.loadError
            ? Promise.reject(module.loadError)
            : Promise.resolve({ isAvailableAsync, requestReview, hasAction, storeUrl }),
    );
    const adapter = createStoreReviewAdapter({ platform, reportError, analytics: { track }, load });

    return { adapter, isAvailableAsync, requestReview, hasAction, storeUrl, reportError, track };
}

describe('createStoreReviewAdapter.request', () => {
    it('a module that fails to load gives failed, one captured error, no event and no throw', async () => {
        const { adapter, reportError, track } = setup('ios', { loadError: new Error('Cannot find native module') });

        await expect(adapter.request()).resolves.toBe('failed');
        expect(reportError).toHaveBeenCalledTimes(1);
        expect(track).not.toHaveBeenCalled();
    });

    it('iOS, store review unavailable: unavailable, one captured error (P51), no request, no event', async () => {
        const { adapter, reportError, requestReview, track } = setup('ios', { available: false });

        await expect(adapter.request()).resolves.toBe('unavailable');
        expect(reportError).toHaveBeenCalledTimes(1);
        expect(isStoreReviewUnavailableError(reportError.mock.calls[0]?.[0])).toBe(true);
        expect(requestReview).not.toHaveBeenCalled();
        expect(track).not.toHaveBeenCalled();
    });

    it('Android, store review unavailable: unavailable and nothing recorded at all', async () => {
        const { adapter, reportError, requestReview, track } = setup('android', { available: false });

        await expect(adapter.request()).resolves.toBe('unavailable');
        expect(reportError).not.toHaveBeenCalled();
        expect(requestReview).not.toHaveBeenCalled();
        expect(track).not.toHaveBeenCalled();
    });

    it('a request that rejects gives failed, one captured error and no event (mutant: track on every result)', async () => {
        const { adapter, reportError, track } = setup('ios', { requestError: new Error('quota') });

        await expect(adapter.request()).resolves.toBe('failed');
        expect(reportError).toHaveBeenCalledTimes(1);
        expect(track).not.toHaveBeenCalled();
    });

    it('a request that resolves gives requested and exactly one event with no properties; two calls give two (R7)', async () => {
        const { adapter, track, reportError } = setup('ios', {});

        await expect(adapter.request()).resolves.toBe('requested');
        expect(track).toHaveBeenCalledTimes(1);
        expect(track).toHaveBeenCalledWith(STORE_REVIEW_REQUESTED_EVENT);
        expect(reportError).not.toHaveBeenCalled();

        await adapter.request();
        expect(track).toHaveBeenCalledTimes(2);
    });

    it.each([
        ['ios', { available: false }],
        ['android', { available: false }],
        ['ios', {}],
        ['ios', { requestError: new Error('x') }],
    ] as const)('never calls hasAction or storeUrl (%s %j) (mutant: gated on hasAction)', async (platform, module) => {
        const { adapter, hasAction, storeUrl } = setup(platform, module);

        await adapter.request();

        expect(hasAction).not.toHaveBeenCalled();
        expect(storeUrl).not.toHaveBeenCalled();
    });
});
