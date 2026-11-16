/**
 * @module storeReview/storeReviewAdapter — the only file that imports `expo-store-review` (plan 0011 KTD5, KTD6; S52).
 * It asks the OS for its own review sheet once per call and draws nothing. The import is lazy, so an old binary built
 * without the native module fails inside `request` (a captured `failed`), never at app start. It never calls
 * `hasAction` or `storeUrl` and never opens a store URL.
 *
 * The `analyticsToken` binding carries only the one event this sends (po P53); a new event is a product decision.
 *
 * @pattern Adapter over `expo-store-review`
 */
import type { AppShellAnalytics, ErrorReporter } from '@commise/features-core';
import {
    STORE_REVIEW_REQUESTED_EVENT,
    type StoreReviewAdapter,
    type StoreReviewResult,
} from '@commise/features-cooking/mobile';

type StoreReviewModule = Pick<typeof import('expo-store-review'), 'isAvailableAsync' | 'requestReview'>;

/** Raised, and reported, when iOS says store review is unavailable (TestFlight included, P51). */
export class StoreReviewUnavailableError extends Error {
    public constructor() {
        super('Store review is unavailable on this device');
        this.name = 'StoreReviewUnavailableError';
        Object.setPrototypeOf(this, StoreReviewUnavailableError.prototype);
    }
}

/**
 * Type guard for {@link StoreReviewUnavailableError}.
 *
 * @param error - The reported value.
 * @returns `true` when `error` is a {@link StoreReviewUnavailableError}.
 */
export function isStoreReviewUnavailableError(error: unknown): error is StoreReviewUnavailableError {
    return error instanceof StoreReviewUnavailableError;
}

export interface StoreReviewAdapterDeps {
    readonly platform: 'ios' | 'android';
    readonly reportError: ErrorReporter;
    readonly analytics: AppShellAnalytics;
    /** Defaults to a lazy `import('expo-store-review')`. Tests inject a fake. */
    readonly load?: () => Promise<StoreReviewModule>;
}

/**
 * Builds the adapter.
 *
 * @param deps - The platform, the reporting seams and, for tests, a module loader.
 * @returns An adapter whose `request` never throws.
 * @sideEffect The returned adapter loads a native module, calls the OS, reports and tracks.
 */
export function createStoreReviewAdapter(deps: StoreReviewAdapterDeps): StoreReviewAdapter {
    const { platform, reportError, analytics, load = () => import('expo-store-review') } = deps;

    return {
        async request(): Promise<StoreReviewResult> {
            try {
                const module = await load();

                if (!(await module.isAvailableAsync())) {
                    // Android records nothing: Play being absent is not a fault. iOS always reports, TestFlight included.
                    if (platform === 'ios') {
                        reportError(new StoreReviewUnavailableError(), { platform });
                    }

                    return 'unavailable';
                }

                await module.requestReview();
                analytics.track(STORE_REVIEW_REQUESTED_EVENT);

                return 'requested';
            } catch (error) {
                reportError(error, { stage: 'storeReview' });

                return 'failed';
            }
        },
    };
}
