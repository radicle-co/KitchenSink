'use client';

/**
 * A notice carried across a navigation in a one-shot query parameter (E8). Every route mounts its own `AppShell`, and the
 * snackbar host with it, so a snackbar raised before `router.push` dies with the page that raised it. The page that
 * leaves puts the outcome in the address instead; the page it lands on says it once, then takes the parameter off the
 * address WITHOUT a navigation (`history.replaceState`, which the App Router folds into its own state), so a reload or
 * a copied link does not say it again.
 *
 * The ADDRESS is the latch: the effect runs again whenever the snackbar host hands out a new handle (it does, every
 * render), and what stops it saying the same thing twice is that the address no longer carries the parameter. A value
 * `noticeOf` does not recognise says nothing and is left where it is.
 */
import { useSnackbar } from '@commise/ui/snackbar';
import { useSearchParams } from 'next/navigation';
import { useEffect } from 'react';

/**
 * Say the notice the address carries, once.
 *
 * @param param - The query parameter that carries the outcome.
 * @param noticeOf - The words for a value, or `undefined` for one this page does not know.
 * @sideEffect Shows a snackbar and rewrites the address bar.
 */
export function useAddressNotice(param: string, noticeOf: (value: string) => string | undefined): void {
    const snackbar = useSnackbar();
    const value = useSearchParams().get(param);
    const notice = value === null ? undefined : noticeOf(value);

    useEffect(() => {
        if (notice === undefined) {
            return;
        }

        const url = new URL(window.location.href);

        if (!url.searchParams.has(param)) {
            return;
        }

        snackbar.show({ message: notice });
        url.searchParams.delete(param);
        window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    }, [notice, param, snackbar]);
}
