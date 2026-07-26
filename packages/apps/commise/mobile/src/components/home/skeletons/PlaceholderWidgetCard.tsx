/**
 * @module home/skeletons/PlaceholderWidgetCard — the shared shell of a roadmap skeleton placeholder (mobile).
 *
 * The native mirror of the web `PlaceholderWidgetCard`. It owns the one accessibility decision every
 * placeholder shares (FR-046 / R6 as amended by CR-001):
 *
 * A roadmap placeholder means "this feature does not exist yet", NOT "content is loading". So the split is by
 * INFORMATION CONTENT: the heading and the visible "Coming soon" badge carry the information and are exposed
 * to assistive tech; the grey blocks carry none — they are a picture of a layout — and are hidden from it
 * (`importantForAccessibility="no-hide-descendants"` on Android, `accessibilityElementsHidden` on iOS). The
 * badge is deliberately visible, not screen-reader-only: a sighted viewer staring at grey rectangles has no
 * other way to tell "coming soon" from "stuck loading". There is no pulse animation — nothing is in progress.
 */
import { palette } from '@commise/ui';
import { nativeTokens } from '@commise/ui/native';
import type { JSX, ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

/** Props for {@link PlaceholderWidgetCard}. */
export interface PlaceholderWidgetCardProps {
    /** The REAL widget's heading (what the viewer will eventually see here). */
    readonly title: string;
    /** The visible "coming soon" badge copy. */
    readonly comingSoonLabel: string;
    /** The skeleton shape. Rendered inside an accessibility-hidden wrapper — pass presentation only. */
    readonly children: ReactNode;
}

/**
 * The shell of a roadmap skeleton placeholder (mobile): a card carrying the real widget's heading, a visible
 * "coming soon" badge, and the caller's shape.
 *
 * @param props - The widget `title`, the `comingSoonLabel`, and the skeleton `children`.
 * @returns A card presenting the coming widget without inventing any of its data.
 */
export function PlaceholderWidgetCard({ title, comingSoonLabel, children }: PlaceholderWidgetCardProps): JSX.Element {
    return (
        <View style={styles.card}>
            <View style={styles.header}>
                <Text accessibilityRole="header" style={styles.title}>
                    {title}
                </Text>
                <Text style={styles.badge}>{comingSoonLabel}</Text>
            </View>

            {/* The shapes carry no information — hide the whole subtree from assistive tech on both platforms. */}
            <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                {children}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    card: {
        gap: nativeTokens.spacing[4],
        borderRadius: nativeTokens.radius.lg,
        borderWidth: 1,
        borderColor: nativeTokens.borderSubtle,
        backgroundColor: 'rgba(255, 255, 255, 0.6)',
        padding: 20,
    },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: nativeTokens.spacing[3] },
    title: { fontSize: nativeTokens.fontSize.bodyMd, fontWeight: '600', color: palette.charcoal },
    badge: { fontSize: nativeTokens.fontSize.caption, fontWeight: '500', color: palette.slate },
});
