/**
 * Segment-level default not-found boundary for `/[locale]` (B18) — catches any unmatched path under a
 * valid locale (e.g. `/en/does-not-exist`), which previously fell through to Next's unstyled default 404.
 * Delegates to the shared {@link RouteNotFoundState}.
 */
import { RouteNotFoundState } from '@/components/app/RouteNotFoundState';

export default function LocaleNotFound(): React.JSX.Element {
    return <RouteNotFoundState />;
}
