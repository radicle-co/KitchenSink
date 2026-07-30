/**
 * `<RedactedAnalytics />` — the ONE sanctioned mount of Vercel Web Analytics.
 *
 * The component renders `null`, so the props it hands the vendor leaf ARE its entire observable output;
 * the cases below therefore drive the `beforeSend` it wired and assert on the RESULTING event, not merely
 * on the prop's identity. A wrapper that mounted `<Analytics />` with the hook missing, misspelled, or
 * pointed at a different redactor would still render identically and still leak — that is the failure this
 * suite exists to catch.
 *
 * The element tree is inspected without mounting (the `layout.test.tsx` precedent), which keeps the real
 * `@vercel/analytics/next` import unexecuted: `inject` only runs inside the vendor's `useEffect`, so no
 * script tag and no beacon can be created here.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Analytics } from '@vercel/analytics/next';

import { RedactedAnalytics } from '../RedactedAnalytics.js';

interface AnalyticsEvent {
    readonly type: string;
    readonly url: string;
}

type BeforeSend = (event: AnalyticsEvent) => AnalyticsEvent | null;

/** The `beforeSend` hook actually handed to the vendor component, as the wrapper renders it. */
function wiredBeforeSend(): BeforeSend {
    const element = RedactedAnalytics();

    expect(element.type).toBe(Analytics);

    const { beforeSend } = element.props as { beforeSend?: unknown };

    expect(beforeSend).toBeInstanceOf(Function);

    return beforeSend as BeforeSend;
}

describe('RedactedAnalytics', () => {
    it('mounts the App-Router Analytics entry point with a beforeSend hook wired', () => {
        expect(wiredBeforeSend()).toBeInstanceOf(Function);
    });

    it('redacts the /discover query string through the hook it wired', () => {
        const beforeSend = wiredBeforeSend();

        expect(
            beforeSend({
                type: 'pageview',
                url: 'https://commise.app/en/discover?query=diabetic%20dinner&dietaryFlags=vegan&tags=weeknight',
            }),
        ).toEqual({ type: 'pageview', url: 'https://commise.app/en/discover' });
    });

    it('keeps the same hook identity across renders, so the vendor does not re-register it', () => {
        // `@vercel/analytics`'s React leaf re-runs its registration effect on every `beforeSend` identity
        // change — an inline arrow here would re-register on every render of every page.
        expect(wiredBeforeSend()).toBe(wiredBeforeSend());
    });

    it('is a client component, because a server component cannot pass a function prop across the RSC boundary', () => {
        // This is why the wrapper exists at all: `[locale]/layout.tsx` is a server component, so a
        // `beforeSend` function prop written there cannot be flight-serialized and every request 500s with
        // "Functions cannot be passed directly to Client Components" (measured). Nothing else catches it —
        // `next build` stays green, because these routes bail out of prerendering — and losing the directive
        // would not change a single render assertion above. Hence a source-level assertion.
        const source = readFileSync(resolve(import.meta.dirname, '../RedactedAnalytics.tsx'), 'utf8');

        expect(source.trimStart().startsWith("'use client';")).toBe(true);
    });
});
