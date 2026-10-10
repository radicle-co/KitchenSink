'use client';

/**
 * @module components/app/AppShell — the app-wide navigation shell (web; `docs/design/uiOverhaul/buildSpec.md` §3).
 *
 * Wraps an authenticated page in {@link HomeChrome} — the sidebar from `nav` (840), the bottom tab bar below it — and
 * in the page's one `ScrollHost`, so the tab bar's second tap, the floating create button and "Back to top" read one
 * scroll. Each page passes its `activeId`.
 *
 * `titleId` names the page in the document title, "{page} · Commise". Routes pass an id rather than a string because
 * they are SERVER components with no locale context, while this shell is a client component that has it; an id-keyed
 * copy record makes a page without a title a compile error.
 *
 * ⚠️ ORCHESTRATION, through exactly three reads: the signed-in profile (`useUserProfile`, for the sidebar's profile
 * row), the router (the sidebar's New recipe opens the editor or the paste page) and the locale. `HomeChrome` below it
 * owns no data at all: data enters the chrome HERE, and never below.
 *
 * @pattern Composition root binding the signed-in profile read and the app-wide capability set to the pure
 *     `HomeChrome` shell — the one place chrome learns who is signed in and what is deployed.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { RECIPE_HOME_WIDGET_CAPABILITY, RecipeCreateButton } from '@commise/features-recipes';
import type { HomeNavItemId } from '@commise/features-core';
import { ScrollHost } from '@commise/ui/scroll-host';
import { SnackbarHost } from '@commise/ui/snackbar';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useEffect, type FC, type ReactNode } from 'react';

import { DEFAULT_SHELL_SURFACE_ID, type ShellSurfaceId } from '@/components/app/shellSurfaces';
import { useSearchShortcut } from '@/components/app/useSearchShortcut';
import { HomeChrome } from '@/components/home/chrome/HomeChrome';
import { profileEntryOf } from '@commise/features-core';
import { useUserProfile } from '@/hooks/useUserProfile';
import { webMessages } from '@/i18n/messages';

/**
 * The backend capabilities this app has actually deployed. Gates which nav destinations are reachable — the
 * unshipped roadmap surfaces (meal-plan / grocery / nutrition) stay gated everywhere. One source of truth,
 * consumed by the shell nav AND by Home's widget curation.
 */
export const LIVE_CAPABILITIES: readonly string[] = [RECIPE_HOME_WIDGET_CAPABILITY];

/** Props for {@link AppShell}. */
export interface AppShellProps {
    /**
     * The active nav destination for this surface (e.g. `'home'`, `'recipes'`), or `null` for a surface that is none
     * of them (the 404 page). Required, so a surface states it rather than inheriting one.
     */
    readonly activeId: HomeNavItemId | null;
    /** Which page the document title names. Defaults to `'home'`. */
    readonly titleId?: ShellSurfaceId;
    /**
     * Whether this surface owns the bottom edge — see `HomeChromeProps.focusedTask`. Set by the recipe
     * wizard routes, whose pinned action bar the tab bar would otherwise cover completely.
     */
    readonly focusedTask?: boolean;

    /** The surface content rendered in the shell's `<main>` landmark. */
    readonly children: ReactNode;
}

/**
 * The authenticated app shell.
 *
 * @param props - The active destination id, the page title id, whether the page is a focused task, and the page.
 * @returns The page in the shared navigation chrome and its scroll host.
 */
export const AppShell: FC<AppShellProps> = ({
    activeId,
    titleId = DEFAULT_SHELL_SURFACE_ID,
    focusedTask = false,
    children,
}) => {
    const { home } = useMessages(webMessages);
    const locale = useLocale();
    const router = useRouter();
    const profile = profileEntryOf(useUserProfile());
    const pageTitle = home.chrome.pageTitles[titleId];

    // `/` focuses the page's search field, unless the cook is typing or has turned it off (A18, WCAG 2.1.4).
    useSearchShortcut();

    // @sideEffect The document title names the page: "{page} · Commise" (`buildSpec.md` §3.3).
    useEffect(() => {
        document.title = `${pageTitle} · ${home.chrome.wordmark}`;
    }, [home.chrome.wordmark, pageTitle]);

    return (
        <ScrollHost>
            <HomeChrome
                chrome={home.chrome}
                locale={locale}
                liveCapabilities={LIVE_CAPABILITIES}
                activeId={activeId}
                profile={profile}
                focusedTask={focusedTask}
                // The sidebar's New recipe opens the empty editor in one tap (`buildSpec.md` §3.4, slice 8).
                newRecipe={(collapsed) => (
                    <RecipeCreateButton
                        appearance={collapsed ? 'rail' : 'sidebar'}
                        onCreateRecipe={() => router.push(`/${locale}/recipes/new` as Route)}
                    />
                )}
            >
                {/* The app's one snackbar host, inside the shell's popup insets so a snackbar sits above the tab bar. */}
                <SnackbarHost>{children}</SnackbarHost>
            </HomeChrome>
        </ScrollHost>
    );
};
