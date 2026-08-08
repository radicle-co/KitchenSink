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
 *
 * ## The widget is announced as a UNIT (#140)
 *
 * The two exposed strings are ONE piece of information ("this named widget is coming"), so they are ONE
 * accessibility element. Left ungrouped, a screen-reader user could land on a bare "Coming soon" with no way to
 * tell which widget it belonged to. The web leaf gets this from a `<section aria-labelledby>` region; React
 * Native has no region landmark, so the equivalent is `accessible` on the header row — RN merges its children's
 * labels into one announcement ("Today's Nutrition, Coming soon"). The `header` role moves up to that same
 * element rather than being dropped, because an `accessible` container's children stop being accessibility
 * elements on iOS and heading navigation would otherwise be lost for every roadmap card.
 *
 * The label is deliberately NOT built here (no `` `${title}, ${comingSoonLabel}` ``): the platform composes it
 * from the children, which keeps word order and punctuation with the localization layer instead of hard-coding
 * an English-shaped sentence. An explicit `accessibilityLabel` would also SUPPRESS the badge, dropping half the
 * information this module exists to expose.
 */
import { palette } from '@commise/ui';
import { nativeTokens } from '@commise/ui/native';
import { GlassCard } from '@commise/ui/surface';
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
    // U8 — the frosted-glass treatment is the shared `GlassCard` primitive (single-sourced with web), so the
    // translucent-over-blur surface (and its no-blur solid fallback) can never drift from the design system.
    // `styles.card` carries only the box (gap/radius/border/pad + `overflow: 'hidden'` so the blur clips to
    // the rounded corners); the surface fill comes from the primitive, so it no longer sets its own colour.
    return (
        <GlassCard tier="card" style={styles.card}>
            <View accessible accessibilityRole="header" style={styles.header}>
                <Text style={styles.title}>{title}</Text>
                <Text style={styles.badge}>{comingSoonLabel}</Text>
            </View>

            {/* The shapes carry no information — hide the whole subtree from assistive tech on both platforms. */}
            <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                {children}
            </View>
        </GlassCard>
    );
}

const styles = StyleSheet.create({
    card: {
        gap: nativeTokens.spacing[4],
        borderRadius: nativeTokens.radius.lg,
        borderWidth: 1,
        borderColor: nativeTokens.borderSubtle,
        overflow: 'hidden',
        padding: 20,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: nativeTokens.spacing[3],
    },
    title: { fontSize: nativeTokens.fontSize.bodyMd, fontWeight: '600', color: palette.charcoal },
    badge: { fontSize: nativeTokens.fontSize.caption, fontWeight: '500', color: palette.slate },
});
