'use client';

/**
 * @module components/app/RouteNotFoundState — the localized, presentational body of the app's 404 page, framed by
 * `NotFoundSurface` (B18, E2). Links back to the Home of the document's locale, read from the `LocaleProvider` — not
 * from the route params, because the global 404 page (`global-not-found.tsx`) renders outside every route and has none.
 */
import type { Route } from 'next';
import Link from 'next/link';
import { useLocale, useMessages } from '@commise/i18n/react';
import type { FC } from 'react';

import { webMessages } from '@/i18n/messages';

/** The 404 page's body: localized "page not found" copy with a way back home. */
export const RouteNotFoundState: FC = () => {
    const { boundary } = useMessages(webMessages);
    const locale = useLocale();

    return (
        // A 404 is a page, not an interruption (`specShellAndLists.md` §N): its title is the page's one `h1`, and nothing
        // here is announced as an alert.
        <div className="mx-auto flex w-full max-w-4xl flex-col items-start gap-3 py-12">
            <h1 className="text-heading-sm font-semibold text-charcoal">{boundary.notFound.title}</h1>
            <p className="text-body-sm text-slate">{boundary.notFound.description}</p>
            <Link href={`/${locale}` as Route}>{boundary.notFound.backHome}</Link>
        </div>
    );
};
