'use client';

/**
 * @module components/app/RouteNotFoundState — the localized, presentational body of the app's 404 page, framed by
 * `NotFoundSurface` (B18, E2). Links back to the Home of the document's locale, read from the `LocaleProvider` — not
 * from the route params, because the global 404 page (`global-not-found.tsx`) renders outside every route and has none.
 */
import type { Route } from 'next';
import Link from 'next/link';
import { useLocale, useMessages } from '@commise/i18n/react';
import { buttonSurfaceClass } from '@commise/ui/button';
import { Icon } from '@commise/ui/icon';
import { LARGE_TITLE_CLASS } from '@commise/ui/large-title-header';
import type { FC } from 'react';

import { webMessages } from '@/i18n/messages';

/** The 404 page's body: localized "page not found" copy with a way back home. */
export const RouteNotFoundState: FC = () => {
    const { boundary } = useMessages(webMessages);
    const locale = useLocale();

    return (
        // A 404 is a page, not an interruption (`specShellAndLists.md` §N): its title is the page's one `h1`, and nothing
        // here is announced as an alert.
        // A terminal moment, so the block is centred (`buildSpec.md` §1.3): the large title, one body line, and the way
        // home as the primary button. It was plain text with an unstyled link (F18).
        <div className="mx-auto flex w-full max-w-reading flex-col items-center gap-4 py-12 text-center">
            <h1 className={LARGE_TITLE_CLASS}>{boundary.notFound.title}</h1>
            <p className="max-w-[62ch] text-body text-ink-muted">{boundary.notFound.description}</p>
            <Link href={`/${locale}` as Route} className={buttonSurfaceClass('primary')}>
                <Icon name="house" size={20} />
                {boundary.notFound.backHome}
            </Link>
        </div>
    );
};
