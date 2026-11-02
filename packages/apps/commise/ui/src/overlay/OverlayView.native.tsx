/**
 * @module @commise/ui/overlay — the root view of a window overlay, which hears the screen-reader escape gesture.
 *
 * VoiceOver's two-finger escape (`onAccessibilityEscape`, iOS) is delivered to the view under the reading cursor or the
 * nearest ancestor that answers it, so it has to sit on a view inside the window. Each overlay's root is this view, with
 * its own props and style, and the gesture becomes the host's `escape` request: the same one door Back, a scrim press and
 * Close use, which the host may refuse. It styles nothing, so the styling stays with the overlay that renders it.
 *
 * A presentational component: it renders its props and holds no state.
 *
 * @pattern Decorator over React Native's `View` — it adds the escape route and nothing else
 */
import type { FC } from 'react';
import { View, type ViewProps } from 'react-native';

import { useOverlayDismiss } from './overlayDismissContext.native.js';

/** A `View` inside an `OverlayHost` whose escape gesture asks the host to close. */
export const OverlayView: FC<ViewProps> = (props) => {
    const request = useOverlayDismiss();

    return <View {...props} onAccessibilityEscape={() => request('escape')} />;
};
