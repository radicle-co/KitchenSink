/**
 * @module home/HomeWidgetErrorNotice — what a FAILED Home widget shows in place of its body (mobile).
 *
 * A pure render component (`props → JSX`, no props, no state, no effects) used as the `fallback` of BOTH
 * per-widget error boundaries on this surface: the host's ({@link import('./HomeWidgetSurface.js')}) and the
 * recipe slot's inner one ({@link import('./RecipeWidgetSlot.js')}). Both previously rendered `null`, so a
 * failed widget left unexplained blank space — and, for a screen-reader user, nothing whatsoever. This is the
 * mobile counterpart of the web host's localized `home.surface.widgetError` fallback: mirroring web's
 * CONTRACT (a localized explanation, and no recovery affordance) rather than its markup.
 *
 * It exists as a component rather than inline JSX at each boundary so "what a broken widget looks like" has
 * ONE representation — the copy, the alert announcement, and the muted-caption treatment cannot drift between
 * the two boundaries, and the surface's tests can pin it once.
 *
 * NOT offered here: a "try again" control. See the boundary comment in `RecipeWidgetSlot.tsx` — the widget is
 * reached through `React.lazy`, which caches a rejected loader permanently, so a retry that merely reset the
 * boundary would re-throw instantly and read as a dead button.
 */
import { useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import { nativeTokens } from '@commise/ui/native';
import type { JSX } from 'react';
import { StyleSheet, Text } from 'react-native';

import { mobileMessages } from '../../i18n/messages.js';

/**
 * The stand-in for a Home widget whose body failed to render.
 *
 * @returns A localized, assertively announced one-line notice.
 */
export function HomeWidgetErrorNotice(): JSX.Element {
    const { home } = useMessages(mobileMessages);

    // `alert` (not plain text): the notice appears only after the widget has already failed mid-session, so a
    // viewer using assistive tech would otherwise have to go looking for it to discover anything was wrong.
    return (
        <Text accessibilityRole="alert" style={styles.notice}>
            {home.widgetError}
        </Text>
    );
}

const styles = StyleSheet.create({
    // The native projection of web's `text-body-sm text-slate` — sourced from the SHARED tokens, so the two
    // platforms' failure copy reads at the same weight in the layout rather than drifting apart by hand.
    notice: { fontSize: nativeTokens.fontSize.bodySm, color: palette.slate },
});
