'use client';

/**
 * The last-resort error page: Next renders it IN PLACE OF the root layout when the layout itself throws, so nothing
 * the layout provides exists here — no locale provider, no global stylesheet, no Tailwind.
 *
 * It still speaks the app's own copy: the default locale's `boundary.error` strings, the same ones every route
 * boundary renders, resolved at module scope without a provider. `lang` comes from the same constant, so the page
 * language cannot disagree with the copy. Only one locale ships; when a second does, read it from the pathname.
 *
 * Try again is Next's `retry()`, which re-fetches the tree (`reset()` would re-render without fetching). Go to Home
 * is a full page load of `/`, the way out of a crash a retry reproduces deterministically.
 */
import { DEFAULT_LOCALE, resolveMessages } from '@commise/i18n';
import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

import { webMessages } from '@/i18n/messages';

const copy = resolveMessages(webMessages, DEFAULT_LOCALE).boundary.error;

export default function GlobalError({
    error,
    retry,
}: {
    readonly error: Error & { digest?: string };
    readonly retry: () => void;
}): React.JSX.Element {
    useEffect(() => {
        Sentry.captureException(error);
    }, [error]);

    return (
        <html lang={DEFAULT_LOCALE}>
            <head>
                <meta name="color-scheme" content="light dark" />
                <title>{copy.title}</title>
            </head>
            <body>
                <main
                    role="alert"
                    style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '1rem',
                        maxWidth: '32rem',
                        margin: '0 auto',
                        padding: '4rem 1.5rem',
                        fontFamily: 'system-ui, sans-serif',
                        textAlign: 'center',
                    }}
                >
                    <h1 style={{ margin: 0, fontSize: '1.5rem' }}>{copy.title}</h1>
                    <p style={{ margin: 0 }}>{copy.description}</p>
                    <button
                        type="button"
                        onClick={() => retry()}
                        style={{ padding: '0.625rem 1.25rem', fontSize: '1rem' }}
                    >
                        {copy.retry}
                    </button>
                    {/* A plain anchor on purpose: a full document load, not a client transition into the tree that
                        just crashed. */}
                    <a href="/">{copy.home}</a>
                </main>
            </body>
        </html>
    );
}
