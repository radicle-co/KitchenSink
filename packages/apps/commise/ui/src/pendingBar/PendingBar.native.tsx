/**
 * @module @commise/ui/pending-bar — the native bar that says the results on screen are being replaced.
 *
 * The same still, 4pt `seafoam` bar as the web leaf, for the same reasons: the results stay at full strength and
 * usable, and nothing moves. React Native has no CSS delay, so the wait is a timer: the bar mounts only once
 * `pending` has held for {@link PENDING_BAR_DELAY_MS}. The timer lives in a child that exists only while pending, so
 * settling unmounts it (cancelling the wait) and the next pending search starts the full delay again — no state to
 * reset.
 *
 * Placement: absolutely positioned, so it takes no layout space. Render it inside a container that follows a
 * `spacing[4]` gap; the negative top centres the bar in that gap. Hidden from assistive tech on iOS, Android and the
 * web build.
 *
 * A presentational leaf apart from the one timer, which waits on an external clock and lives in an effect.
 *
 * @pattern Delayed reveal — CSS animation-delay on web, a timer child on native
 */
import { useEffect, useState, type FC } from 'react';
import { StyleSheet, View } from 'react-native';

import { palette } from '../tokens/colors.js';
import { nativeTokens } from '../tokens/native.js';
import { PENDING_BAR_DELAY_MS } from './pendingDelay.js';
import type { PendingBarProps } from './props.js';

/** The pending-results bar: nothing while nothing is pending, then the delayed still bar. */
export const PendingBar: FC<PendingBarProps> = ({ pending }) => (pending ? <DelayedBar /> : null);

/** The bar, shown once it has been mounted for the delay. Mounted only while pending. */
const DelayedBar: FC = () => {
    const [shown, setShown] = useState(false);

    useEffect(() => {
        const timer = setTimeout(() => setShown(true), PENDING_BAR_DELAY_MS);

        return () => clearTimeout(timer);
    }, []);

    return shown ? (
        <View
            aria-hidden
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            pointerEvents="none"
            style={styles.bar}
        />
    ) : null;
};

const styles = StyleSheet.create({
    bar: {
        position: 'absolute',
        left: 0,
        right: 0,
        top: -(nativeTokens.spacing[2] + nativeTokens.spacing[1] / 2),
        height: nativeTokens.spacing[1],
        borderRadius: nativeTokens.radius.full,
        backgroundColor: palette.seafoam,
    },
});
