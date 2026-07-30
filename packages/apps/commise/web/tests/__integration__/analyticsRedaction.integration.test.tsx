/**
 * Integration: the redaction interceptor against the REAL `@vercel/analytics` registration pipeline.
 *
 * The unit suites prove the projection is correct (`tests/lib/analyticsRedaction.test.ts`) and that the
 * wrapper passes it as a prop (`src/components/app/__tests__/RedactedAnalytics.test.tsx`). Neither proves
 * the vendor ACCEPTS it: `@vercel/analytics` does not consume `beforeSend` as a prop at send time, it
 * registers it out-of-band by pushing `['beforeSend', fn]` onto the global `window.vaq` queue from inside
 * its own `useEffect` (`initQueue` → `window.va('beforeSend', …)`), and the remote script later pulls it
 * off that queue. A hook that never reaches the queue is a hook that never redacts, and every prop-level
 * assertion in the repo would still pass. So this suite mounts the real component, with the real vendor
 * package (no mock), and drives the function the vendor actually captured.
 *
 * "Real dependency" here is the vendor's browser registration mechanism plus jsdom's real DOM — the only
 * dependency this code has. No network is reachable: jsdom does not fetch injected `<script>` resources,
 * and under `NODE_ENV=test` the package resolves to its debug script rather than a collection endpoint.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';

import { RedactedAnalytics } from '@/components/app/RedactedAnalytics';

interface AnalyticsEvent {
    readonly type: string;
    readonly url: string;
}

type BeforeSend = (event: AnalyticsEvent) => AnalyticsEvent | null;

/**
 * The `beforeSend` the vendor captured on its global queue — i.e. the function the collection script will
 * actually run. Fails loudly rather than returning a stub, so a missing registration cannot read as a pass.
 */
function registeredBeforeSend(): BeforeSend {
    const queued = (window.vaq ?? []).filter(([event]) => event === 'beforeSend');

    expect(queued, 'the vendor captured no beforeSend hook').toHaveLength(1);

    const [entry] = queued;
    const hook = entry?.[1];

    expect(hook).toBeInstanceOf(Function);

    return hook as BeforeSend;
}

beforeEach(() => {
    // The vendor's queue and its injected script tag are GLOBAL state, and `inject` short-circuits when a
    // script with the same src is already in `<head>` — without this reset the second mount is a no-op.
    delete window.va;
    delete window.vaq;
    delete window.vai;
    delete window.vam;

    for (const script of document.head.querySelectorAll('script')) {
        script.remove();
    }
});

afterEach(cleanup);

describe('Vercel Web Analytics redaction, end to end through the vendor pipeline', () => {
    it('registers the redaction hook on the vendor queue when mounted', () => {
        render(<RedactedAnalytics />);

        expect(registeredBeforeSend()).toBeInstanceOf(Function);
    });

    it('strips every /discover filter param from the event the vendor would send', () => {
        render(<RedactedAnalytics />);

        const event = registeredBeforeSend()({
            type: 'pageview',
            url:
                'https://commise.app/en/discover?query=diabetic%20dinner&dietaryFlags=vegan' +
                '&dietaryFlags=gluten-free&tags=weeknight&cuisine=indian&ingredientName=paneer',
        });

        expect(event).toEqual({ type: 'pageview', url: 'https://commise.app/en/discover' });
    });

    it('strips the Clerk handshake/ticket params while keeping the auth page view', () => {
        render(<RedactedAnalytics />);

        const beforeSend = registeredBeforeSend();

        expect(beforeSend({ type: 'pageview', url: 'https://commise.app/en?__clerk_handshake=a.b.c' })?.url).toBe(
            'https://commise.app/en',
        );
        expect(
            beforeSend({ type: 'pageview', url: 'https://commise.app/en/sign-in?__clerk_ticket=abc123def456' })?.url,
        ).toBe('https://commise.app/en/sign-in');
    });

    it('drops an unparseable URL rather than forwarding it', () => {
        render(<RedactedAnalytics />);

        expect(registeredBeforeSend()({ type: 'pageview', url: '/en/discover?query=insulin' })).toBeNull();
    });

    it('leaves an already-clean page view intact, so the pathname still reaches the report', () => {
        render(<RedactedAnalytics />);

        expect(registeredBeforeSend()({ type: 'pageview', url: 'https://commise.app/en/recipes/01HZY8QK7M' })).toEqual({
            type: 'pageview',
            url: 'https://commise.app/en/recipes/01HZY8QK7M',
        });
    });

    it('adds no DOM of its own — the leaf is a Null Object', () => {
        const { container } = render(<RedactedAnalytics />);

        expect(container).toBeEmptyDOMElement();
    });
});
