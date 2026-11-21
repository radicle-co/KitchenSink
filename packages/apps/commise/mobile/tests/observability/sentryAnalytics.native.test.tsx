/**
 * The phone's analytics adapter: it forwards the ONE event S12 sends and drops every other name (po P53, redteam RT7), so
 * binding `analyticsToken` is not a free ride for a new product event.
 */
import { STORE_REVIEW_REQUESTED_EVENT } from '@commise/features-cooking/mobile';
import * as Sentry from '@sentry/react-native';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { sentryAnalytics } from '../../src/observability/sentryAnalytics';

vi.mock('@sentry/react-native', () => ({ captureMessage: vi.fn() }));

afterEach(() => {
    vi.mocked(Sentry.captureMessage).mockClear();
});

describe('sentryAnalytics.track', () => {
    it('sends the S12 event as one info-level message', () => {
        sentryAnalytics.track(STORE_REVIEW_REQUESTED_EVENT);

        expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
        expect(Sentry.captureMessage).toHaveBeenCalledWith(STORE_REVIEW_REQUESTED_EVENT, { level: 'info' });
    });

    it('passes the caller`s properties through as `extra`, and adds none of its own', () => {
        sentryAnalytics.track(STORE_REVIEW_REQUESTED_EVENT, { a: 1 });

        expect(Sentry.captureMessage).toHaveBeenCalledWith(STORE_REVIEW_REQUESTED_EVENT, {
            level: 'info',
            extra: { a: 1 },
        });
    });

    it('drops any other event name and sends nothing (mutant: forwards every name)', () => {
        sentryAnalytics.track('anything.else', { userId: 'u' });

        expect(Sentry.captureMessage).not.toHaveBeenCalled();
    });

    it('the message carries no user id, recipe id or title key (mutant: the user id added)', () => {
        sentryAnalytics.track(STORE_REVIEW_REQUESTED_EVENT);

        const [, hint] = vi.mocked(Sentry.captureMessage).mock.calls[0] ?? [];

        expect(Object.keys(hint ?? {})).toEqual(['level']);
    });
});
