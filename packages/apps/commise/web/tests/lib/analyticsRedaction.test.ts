/**
 * The Vercel Web Analytics transmit-seam interceptor (`beforeSend`).
 *
 * These cases are written against the RESULTING event — the exact object handed back to the beacon — not
 * against internal calls, because the event IS the wire payload: anything still on it ships to Vercel.
 *
 * The load-bearing property is **default-deny**: the assertions below do not merely check that today's
 * five known-sensitive `/discover` params are gone, they check that a param nobody has classified
 * (`maxTotalTime`, a harmless-looking time bound) is gone too. That is the mutation-lens test — swap the
 * implementation for a denylist of known-bad keys and the suite goes red, which is the whole point: a
 * sixth filter param added to `filtersToQueryString` next month must not silently start leaking.
 */
import { describe, expect, it } from 'vitest';

import { redactAnalyticsEvent, redactAnalyticsUrl } from '@/lib/analyticsRedaction';

/** A page-view event as the beacon hands it to `beforeSend`: a discriminant plus an absolute URL. */
const pageView = (url: string) => ({ type: 'pageview', url }) as const;

describe('redactAnalyticsUrl — default-deny projection of a page-view URL', () => {
    it('drops the whole query string of a /discover URL carrying all five filter params', () => {
        // The concrete leak: free-text `query`, Art. 9-adjacent `dietaryFlags`, plus tags/cuisine/
        // ingredientName — every one of them appended by `filtersToQueryString`.
        const raw =
            'https://commise.app/en/discover?query=diabetic%20dinner&dietaryFlags=vegan' +
            '&dietaryFlags=gluten-free&tags=weeknight&cuisine=indian&ingredientName=paneer';

        expect(redactAnalyticsUrl(raw)).toBe('https://commise.app/en/discover');
    });

    it('leaves no trace of a sensitive value anywhere in the redacted URL', () => {
        const raw = 'https://commise.app/en/discover?query=hiv%20treatment%20recipes&dietaryFlags=kosher';
        const redacted = redactAnalyticsUrl(raw);

        expect(redacted).not.toBeNull();
        expect(redacted).not.toContain('hiv');
        expect(redacted).not.toContain('kosher');
        expect(redacted).not.toContain('?');
        expect(redacted).not.toContain('=');
    });

    it('drops a param nobody classified as sensitive — the policy is deny-all, not a denylist', () => {
        // `maxTotalTime` is a bounded integer bucket and is genuinely harmless. It is dropped anyway,
        // because "allow what we have not reviewed" is the failure mode, not the value of this one param.
        expect(redactAnalyticsUrl('https://commise.app/en/discover?maxTotalTime=30&maxPrepTime=15')).toBe(
            'https://commise.app/en/discover',
        );
    });

    it('drops the credential-shaped Clerk params without dropping the page view', () => {
        expect(redactAnalyticsUrl('https://commise.app/en?__clerk_handshake=eyJhbGci.payload.signature')).toBe(
            'https://commise.app/en',
        );
        expect(redactAnalyticsUrl('https://commise.app/en/sign-in?__clerk_ticket=abc123def456')).toBe(
            'https://commise.app/en/sign-in',
        );
    });

    it('drops the fragment, which can carry an implicit-flow token the query never sees', () => {
        expect(redactAnalyticsUrl('https://commise.app/en/sign-in#access_token=aaaaaaaa.bbbbbbbb.cccccccc')).toBe(
            'https://commise.app/en/sign-in',
        );
    });

    it('drops URL userinfo credentials', () => {
        expect(redactAnalyticsUrl('https://someone:secret@commise.app/en/discover')).toBe(
            'https://commise.app/en/discover',
        );
    });

    it('returns a bare path unchanged, so the pathname survives redaction', () => {
        // Losing pathnames makes the tool pointless — this is the "what we KEEP" assertion.
        expect(redactAnalyticsUrl('https://commise.app/en/recipes/01HZY8QK7M3E4V5N6P7R8S9T0A')).toBe(
            'https://commise.app/en/recipes/01HZY8QK7M3E4V5N6P7R8S9T0A',
        );
        expect(redactAnalyticsUrl('https://pr-73.sandbox.commise.app/es/discover')).toBe(
            'https://pr-73.sandbox.commise.app/es/discover',
        );
    });

    it('redacts an email- or bearer-shaped segment inside the pathname', () => {
        // Reachable TODAY, not hypothetical: `sign-in/[[...sign-in]]` and `sign-up/[[...sign-up]]` are
        // OPTIONAL CATCH-ALLS, so any depth of visitor-authored path renders through this layout.
        expect(redactAnalyticsUrl('https://commise.app/en/sign-in/webb.c.brandon@gmail.com')).toBe(
            'https://commise.app/en/sign-in/[redacted]',
        );
        expect(redactAnalyticsUrl('https://commise.app/en/sign-up/eyJhbGciOi.eyJzdWIiOi.c2lnbmF0dXJl')).toBe(
            'https://commise.app/en/sign-up/[redacted]',
        );
    });

    it('returns null for a URL it cannot parse, rather than guessing', () => {
        // Default-deny extends to shape: an unparseable URL cannot be PROVEN query-free, so it is dropped.
        expect(redactAnalyticsUrl('/en/discover?query=diabetic%20dinner')).toBeNull();
        expect(redactAnalyticsUrl('not a url at all')).toBeNull();
        expect(redactAnalyticsUrl('')).toBeNull();
    });
});

describe('redactAnalyticsEvent — the beforeSend hook', () => {
    it('returns the event with a redacted URL and its discriminant intact', () => {
        expect(redactAnalyticsEvent(pageView('https://commise.app/en/discover?query=insulin'))).toEqual({
            type: 'pageview',
            url: 'https://commise.app/en/discover',
        });
    });

    it('keeps the sign-in page view — the ticket is gone, and the funnel step is not itself sensitive', () => {
        const event = redactAnalyticsEvent(pageView('https://commise.app/en/sign-in?__clerk_ticket=abc123def456'));

        expect(event).not.toBeNull();
        expect(event?.url).toBe('https://commise.app/en/sign-in');
    });

    it('applies to custom events too, not only page views', () => {
        expect(redactAnalyticsEvent({ type: 'event', url: 'https://commise.app/en/discover?query=insulin' })).toEqual({
            type: 'event',
            url: 'https://commise.app/en/discover',
        });
    });

    it('drops the event when the URL cannot be parsed', () => {
        expect(redactAnalyticsEvent(pageView('/en/discover?query=insulin'))).toBeNull();
    });

    it('does not mutate the event it was given', () => {
        // Purity: the beacon's own object must come back untouched, so a redaction bug cannot be masked by
        // (or leak through) an in-place edit of caller state.
        const raw = 'https://commise.app/en/discover?query=insulin';
        const event = pageView(raw);

        redactAnalyticsEvent(event);

        expect(event.url).toBe(raw);
    });
});
