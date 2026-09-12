/**
 * @module home/SubscriptionNudge — the once-per-session subscription upgrade nudge (mobile).
 *
 * FR-046: a free-tier viewer who taps a premium-gated entry point on Home sees an upgrade nudge **at most
 * once per session**. The nudge is host-owned chrome; a widget triggers it through `useHomeNudge`
 * (the seam a future premium-gated widget calls). In Home v1 no live widget is premium-gated, so the
 * mechanism ships ready for the first gated widget (005–009) rather than firing on any current surface.
 *
 * "Once per session" is deliberately **component state**, not persisted — the requirement is per-session,
 * and an app relaunch legitimately starts a new session. Mirrors the web nudge's hook logic exactly; only
 * the presentation differs.
 *
 * It sits on the design system's `Sheet` (`docs/design/compactHeightLayout.md` §10): the width cap, the insets, the
 * scroll, the slide and every close route (×, the scrim, a swipe, Android back) come with it. It was a hand-rolled
 * bottom panel that spanned a sideways phone's whole width under the navigation bar. Both choices are full
 * design-system buttons of equal reach, the primary last, at the thumb's end; the row wraps before a label does.
 * Web keeps its own Radix dialog: below 640 px the web `Sheet` is full screen, which is wrong for three lines.
 *
 * @pattern Adapter over `@commise/ui/sheet` — the platform expression of the web leaf's Radix dialog.
 */
import { useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import { Button } from '@commise/ui/button';
import { nativeTokens } from '@commise/ui/native';
import { Sheet } from '@commise/ui/sheet';
import { Feather } from '@expo/vector-icons';
import type { JSX } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { mobileMessages } from '../../i18n/messages.js';

/** Action glyph size — the design-system Button pairs every label with an icon. */
const ACTION_ICON_SIZE = 16;

/** Props for `SubscriptionNudge`. */
export interface SubscriptionNudgeProps {
    /** Whether the nudge is shown. */
    readonly open: boolean;
    /** Invoked when the viewer dismisses the nudge. */
    readonly onDismiss: () => void;
}

/**
 * The upgrade nudge, on the design-system sheet. Renders nothing when closed. Copy is localized via the mobile
 * dictionary.
 *
 * The upgrade action currently dismisses (the subscription surface is owned by 010, not yet shipped); it is
 * wired as a distinct action so it becomes a real destination without a structural change when 010 lands.
 * ⚠️ A control named for a destination that goes nowhere: wire it to 010's plans before the first gated widget ships.
 *
 * @param props - Whether the nudge is `open` and its `onDismiss` handler.
 * @returns The nudge sheet.
 */
export function SubscriptionNudge({ open, onDismiss }: SubscriptionNudgeProps): JSX.Element {
    const { home } = useMessages(mobileMessages);

    return (
        <Sheet
            open={open}
            // Every close route reports `false`; the nudge never opens itself.
            onOpenChange={(next) => {
                if (!next) {
                    onDismiss();
                }
            }}
            title={home.nudge.title}
            closeLabel={home.nudge.close}
            size="content"
            footer={
                <View style={styles.actions}>
                    <View style={styles.action}>
                        <Button
                            variant="secondary"
                            icon={<Feather name="clock" size={ACTION_ICON_SIZE} color={palette.charcoal} />}
                            onPress={onDismiss}
                        >
                            {home.nudge.dismiss}
                        </Button>
                    </View>
                    <View style={styles.action}>
                        <Button
                            icon={<Feather name="arrow-right" size={ACTION_ICON_SIZE} color={palette.white} />}
                            onPress={onDismiss}
                        >
                            {home.nudge.upgrade}
                        </Button>
                    </View>
                </View>
            }
        >
            <Text style={styles.body}>{home.nudge.body}</Text>
        </Sheet>
    );
}

const styles = StyleSheet.create({
    body: { fontSize: nativeTokens.fontSize.bodySm, color: palette.slate },
    // `flexWrap`: at a large font scale the two actions take a line each, full width, before a label wraps.
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: nativeTokens.spacing[3] },
    action: { flexGrow: 1 },
});
