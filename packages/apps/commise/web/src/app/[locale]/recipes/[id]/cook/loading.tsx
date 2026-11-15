'use client';

/**
 * Loading boundary for the cook route segment (`/[locale]/recipes/[id]/cook`). It reserves cooking mode's own shape, the
 * S28 loading frame, rather than the recipe page's skeleton, so the screen does not reflow when the page settles.
 */
import { CookingScreen } from '@commise/features-cooking/web';
import { useParams } from 'next/navigation';

import { useWays } from './CookingRoute';

/** Nothing to read again yet: the page is still loading. */
const noop = (): void => undefined;

export default function CookingLoading(): React.JSX.Element {
    const { id } = useParams<{ id: string }>();

    return <CookingScreen read={{ kind: 'pending', retry: noop }} {...useWays(id)} />;
}
