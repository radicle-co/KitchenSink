'use client';

/**
 * @module components/app/RouteNotFoundState — the shared, localized presentational fallback rendered by
 * every web App Router `not-found.tsx` boundary (B18). Reads the matched `locale` route param (always
 * present — `not-found.tsx` only renders nested under a matched `[locale]` segment) via `useParams` — Next
 * does not pass params as props to `not-found.tsx` — to link back to that locale's Home.
 */
import type { Route } from 'next';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMessages } from '@commise/i18n/react';
import type { FC } from 'react';

import { webMessages } from '@/i18n/messages';

/** Localized "page not found" state with a way back, shared by every route's `not-found.tsx`. */
export const RouteNotFoundState: FC = () => {
    const { boundary } = useMessages(webMessages);
    const { locale } = useParams<{ locale: string }>();

    return (
        <div role="alert" className="mx-auto flex w-full max-w-4xl flex-col items-start gap-3 py-12">
            <p className="text-heading-sm font-semibold text-charcoal">{boundary.notFound.title}</p>
            <p className="text-body-sm text-slate">{boundary.notFound.description}</p>
            <Link href={`/${locale}` as Route}>{boundary.notFound.backHome}</Link>
        </div>
    );
};
