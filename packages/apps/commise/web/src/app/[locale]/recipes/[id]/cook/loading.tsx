'use client';

/**
 * Loading boundary for the cook route segment (`/[locale]/recipes/[id]/cook`). It reserves cooking mode's own shape, the
 * S28 loading frame, rather than the recipe page's skeleton, so the screen does not reflow when the page settles.
 */
import { CookingScreen } from '@commise/features-cooking/web';
import { useParams } from 'next/navigation';

import { CookingNoticeMount } from './CookingNoticeMount';
import { useCookWays } from './useCookWays';

/** Nothing to read again yet: the page is still loading. */
const noop = (): void => undefined;

export default function CookingLoading(): React.JSX.Element {
    const { id } = useParams<{ id: string }>();
    const ways = useCookWays(id);

    return (
        <CookingNoticeMount>
            <CookingScreen read={{ kind: 'pending', retry: noop }} {...ways} />
        </CookingNoticeMount>
    );
}
