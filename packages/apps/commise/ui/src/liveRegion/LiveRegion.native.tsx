/**
 * @module @commise/ui/live-region — visible text whose appearance and changes are SPOKEN, on both platforms
 * (React Native only).
 *
 * ⛔ ONE CHANNEL PER PLATFORM, NEVER BOTH. Android speaks a text node carrying `accessibilityLiveRegion` on its
 * own. iOS has no live region at all, so a failure alert or a progress caption that only set that prop was
 * SILENT to VoiceOver users; iOS is given an imperative announcement instead. Owning that choice here means no
 * caller can forget iOS, and none can make Android speak twice by adding the announcement too.
 *
 * A presentational leaf — `props → Text` — apart from the one imperative announcement iOS requires, which is
 * external-system synchronisation and lives in an effect.
 *
 * ⚠️ Mount it BEFORE there is anything to say (empty `children`) wherever the message can change or appear later:
 * Android announces a CHANGE to a live region it already holds, and a region that mounts with its text is not
 * reliably spoken there. An empty message is silent on both platforms and takes no layout space.
 *
 * `visuallyHidden` is for a message the screen already shows another way. It is never laid out, and on iOS its node
 * is hidden from VoiceOver, which hears the announcement and would otherwise find the same words again as an
 * invisible swipe stop. On Android the node IS the channel, so it stays exposed: the cost there is that swipe stop.
 *
 * ⚠️ Not for text that screen-reader FOCUS is moved onto — that text is read by the focus move, and a live
 * region on it would read it twice.
 *
 * @pattern Adapter over the platform live-region channels — Android live region, iOS imperative announcement,
 *     never both
 */
import { useEffect, useState, type FC } from 'react';
import { AccessibilityInfo, Platform, StyleSheet, Text } from 'react-native';

import type { LiveRegionProps } from './props.js';

/** Visible text whose appearance and changes are announced to the screen reader. */
export const LiveRegion: FC<LiveRegionProps> = ({ children, politeness, style, visuallyHidden = false }) => {
    // Whether this message REPLACES one the region was already saying — derived during render from the previous
    // render's message (React's "store information from previous renders" state pattern, not a ref).
    const [previousMessage, setPreviousMessage] = useState(children);
    const [supersedesOwn, setSupersedesOwn] = useState(false);

    if (children !== previousMessage) {
        setPreviousMessage(children);
        setSupersedesOwn(previousMessage !== '');
    }

    useEffect(() => {
        // An always-mounted region is empty until there is something to say; announcing '' is a blip, not speech.
        if (Platform.OS !== 'ios' || children === '') {
            return;
        }

        // `queue` (iOS-only): a polite message waits behind current speech; an assertive one interrupts it. A polite
        // message that replaces the region's OWN previous one interrupts too, so rapid changes (a stepper tapped five
        // times) are not read out as a backlog — Android's live region coalesces them the same way.
        AccessibilityInfo.announceForAccessibilityWithOptions(children, {
            queue: politeness === 'polite' && !supersedesOwn,
        });
    }, [children, politeness, supersedesOwn]);

    return (
        <Text
            accessibilityRole={politeness === 'assertive' && children !== '' ? 'alert' : undefined}
            accessibilityLiveRegion={politeness}
            aria-live={politeness}
            // Only iOS: `aria-hidden` there is `accessibilityElementsHidden`, but on Android it would hide the very
            // node whose live region speaks.
            aria-hidden={visuallyHidden && Platform.OS === 'ios' ? true : undefined}
            // Empty, it stays MOUNTED (Android's region must exist before its text changes) but leaves the layout
            // flow, so a caller mounting it early inside a `gap` layout opens no blank row.
            style={visuallyHidden || children === '' ? styles.hidden : style}
        >
            {children}
        </Text>
    );
};

const styles = StyleSheet.create({
    hidden: { position: 'absolute', width: 1, height: 1, overflow: 'hidden' },
});
