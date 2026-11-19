import type { CookingScreenProps } from '@commise/features-cooking/web';
import type { Route } from 'next';
import { useParams, useRouter } from 'next/navigation';

/** Where each way out of cooking mode goes. */
export type CookWays = Pick<CookingScreenProps, 'onLeave' | 'onEdit' | 'onHome'>;

/**
 * Where each way out of cooking mode goes, shared by the route and the segment's loading frame. It lives in its own
 * module so the loading boundary does not pull in the route's whole import graph.
 *
 * Every way out REPLACES this route rather than pushing, so browser Back never re-enters cooking mode (R-11).
 *
 * @param id - The recipe id from the `[id]` segment.
 * @returns The three callbacks `CookingScreen` takes.
 */
export function useCookWays(id: string): CookWays {
    const { locale } = useParams<{ locale: string }>();
    const router = useRouter();

    return {
        onLeave: () => router.replace(`/${locale}/recipes/${id}` as Route),
        onEdit: () => router.replace(`/${locale}/recipes/${id}/edit` as Route),
        onHome: () => router.replace(`/${locale}` as Route),
    };
}
