/**
 * Segment-level default loading boundary for `/[locale]` (B18) — the Suspense fallback shown while the
 * server render (params/auth) of a route with no more specific `loading.tsx` resolves. Delegates to the
 * shared {@link RouteLoadingState}.
 */
import { RouteLoadingState } from '@/components/app/RouteLoadingState';

export default function LocaleLoading(): React.JSX.Element {
    return <RouteLoadingState />;
}
