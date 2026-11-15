'use client';

/**
 * Orchestration only: the loading boundary for the cook route segment (`/[locale]/recipes/[id]/cook`). It reserves cooking mode's own shape, the
 * S28 loading frame, rather than the recipe page's skeleton, so the screen does not reflow when the page settles.
 *
 * @pattern Suspense fallback — Next's segment loading convention, drawing the screen's own pending frame
 */
import { CookingScreen } from '@commise/features-cooking/web';
import { useParams, useRouter } from 'next/navigation';
import type { Route } from 'next';

/** Nothing to read again yet: the page is still loading. */
const noop = (): void => undefined;

export default function CookingLoading(): React.JSX.Element {
    const { locale, id } = useParams<{ locale: string; id: string }>();
    const router = useRouter();

    return (
        <CookingScreen
            read={{ kind: 'pending', retry: noop }}
            onLeave={() => router.replace(`/${locale}/recipes/${id}` as Route)}
            onEdit={noop}
            onHome={noop}
        />
    );
}
