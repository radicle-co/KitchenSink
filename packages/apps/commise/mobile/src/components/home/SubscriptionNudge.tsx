/**
 * @module home/SubscriptionNudge — the once-per-session subscription upgrade nudge (mobile).
 *
 * FR-046: a free-tier viewer who taps a premium-gated entry point on Home sees an upgrade nudge **at most
 * once per session**. The nudge is host-owned chrome; a widget triggers it through {@link useHomeNudge}
 * (the seam a future premium-gated widget calls). In Home v1 no live widget is premium-gated, so the
 * mechanism ships ready for the first gated widget (005–009) rather than firing on any current surface.
 *
 * "Once per session" is deliberately **component state** (a ref guard), not persisted — the requirement is
 * per-session, and an app relaunch legitimately starts a new session. Mirrors the web nudge's hook logic
 * exactly; only the presentation swaps to a React Native `Modal`.
 */
import { useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import { createContext, useCallback, useContext, useRef, useState, type JSX } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { mobileMessages } from '../../i18n/messages.js';

/** The nudge trigger seam exposed to widgets via {@link HomeNudgeContext}. */
export interface HomeNudge {
    /** Request the upgrade nudge. A no-op after the nudge has already been shown once this session. */
    readonly trigger: () => void;
}

/** Context carrying the {@link HomeNudge} trigger down to widgets (provided by the Home surface). */
export const HomeNudgeContext = createContext<HomeNudge | null>(null);

/**
 * Read the Home nudge trigger. A premium-gated widget calls `useHomeNudge().trigger()` when a free-tier
 * viewer taps its gated entry point.
 *
 * @returns The {@link HomeNudge} trigger.
 * @throws {Error} when used outside the Home widget surface (no provider).
 */
export function useHomeNudge(): HomeNudge {
    const nudge = useContext(HomeNudgeContext);

    if (nudge === null) {
        throw new Error('useHomeNudge must be used within the Home widget surface.');
    }

    return nudge;
}

/** The live nudge state owned by the Home surface: whether it is visible plus its trigger/dismiss controls. */
export interface OncePerSessionNudge {
    /** Whether the nudge is currently shown. */
    readonly visible: boolean;
    /** Show the nudge — a no-op once it has already been shown this session. */
    readonly trigger: () => void;
    /** Hide the nudge (does not re-arm it — it stays spent for the session). */
    readonly dismiss: () => void;
}

/**
 * Own the once-per-session nudge state. The first {@link OncePerSessionNudge.trigger} shows it; a ref guard
 * makes every later trigger a no-op for the session, so it can appear at most once regardless of how many
 * gated taps occur. Dismissing hides it without re-arming.
 *
 * @returns The nudge visibility plus its trigger/dismiss controls.
 */
export function useOncePerSessionNudge(): OncePerSessionNudge {
    const [visible, setVisible] = useState(false);
    const shown = useRef(false);

    const trigger = useCallback(() => {
        if (shown.current) {
            return;
        }

        shown.current = true;
        setVisible(true);
    }, []);

    const dismiss = useCallback(() => setVisible(false), []);

    return { visible, trigger, dismiss };
}

/** Props for {@link SubscriptionNudge}. */
export interface SubscriptionNudgeProps {
    /** Whether the nudge is shown. */
    readonly open: boolean;
    /** Invoked when the viewer dismisses the nudge. */
    readonly onDismiss: () => void;
}

/**
 * The upgrade nudge dialog, presented as a bottom-sheet `Modal`. Renders nothing when closed. Copy is
 * localized via the mobile dictionary.
 *
 * The upgrade action currently dismisses (the subscription surface is owned by 010, not yet shipped); it is
 * wired as a distinct action so it becomes a real destination without a structural change when 010 lands.
 *
 * @param props - Whether the nudge is `open` and its `onDismiss` handler.
 * @returns The nudge modal.
 */
export function SubscriptionNudge({ open, onDismiss }: SubscriptionNudgeProps): JSX.Element {
    const { home } = useMessages(mobileMessages);

    return (
        <Modal visible={open} transparent animationType="none" onRequestClose={onDismiss}>
            <View style={styles.backdrop}>
                <View accessibilityViewIsModal accessibilityLabel={home.nudge.title} style={styles.sheet}>
                    <Text accessibilityRole="header" style={styles.title}>
                        {home.nudge.title}
                    </Text>
                    <Text style={styles.body}>{home.nudge.body}</Text>
                    <View style={styles.actions}>
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={home.nudge.dismiss}
                            onPress={onDismiss}
                            style={styles.dismissButton}
                        >
                            <Text style={styles.dismissLabel}>{home.nudge.dismiss}</Text>
                        </Pressable>
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={home.nudge.upgrade}
                            onPress={onDismiss}
                            style={styles.upgradeButton}
                        >
                            <Text style={styles.upgradeLabel}>{home.nudge.upgrade}</Text>
                        </Pressable>
                    </View>
                </View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(45, 52, 54, 0.4)' },
    sheet: {
        gap: 12,
        padding: 24,
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        backgroundColor: palette.white,
    },
    title: { fontSize: 18, fontWeight: '600', color: palette.charcoal },
    body: { fontSize: 14, color: palette.slate },
    actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12 },
    dismissButton: { paddingVertical: 8, paddingHorizontal: 16 },
    dismissLabel: { fontSize: 14, fontWeight: '500', color: palette.slate },
    upgradeButton: { paddingVertical: 8, paddingHorizontal: 20, borderRadius: 999, backgroundColor: palette.seafoam },
    upgradeLabel: { fontSize: 14, fontWeight: '600', color: palette.white },
});
