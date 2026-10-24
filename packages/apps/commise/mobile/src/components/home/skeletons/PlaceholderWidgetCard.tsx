/**
 * @module home/skeletons/PlaceholderWidgetCard — the shared shell of a roadmap skeleton placeholder (mobile).
 *
 * The native mirror of the web `PlaceholderWidgetCard`. It owns the one accessibility decision every
 * placeholder shares (FR-046 / R6 as amended by CR-001):
 *
 * A roadmap placeholder means "this feature does not exist yet", NOT "content is loading". So the split is by
 * INFORMATION CONTENT: the heading and the visible "Coming soon" badge carry the information and are exposed
 * to assistive tech; the grey blocks carry none — they are a picture of a layout — and are hidden from it. The
 * badge is deliberately visible, not screen-reader-only: a sighted viewer staring at grey rectangles has no
 * other way to tell "coming soon" from "stuck loading". There is no pulse animation — nothing is in progress.
 *
 * ## Hiding the shapes is the CALLER's job, exactly as on web
 *
 * This shell used to wrap `children` in one hidden subtree, and that was a defect: not every placeholder's
 * children are pure shape. `MealPlanWidgetSkeleton` renders REAL, locale-formatted weekday names alongside the
 * unknown meal thumbnails and its own JSDoc promises they "stay exposed to assistive tech" — but a hidden
 * ancestor cannot be undone by a descendant, so the blanket wrapper silenced all seven on device. The web leaf
 * refuses that wrapper for precisely this reason; native now matches, so the rule lives in ONE place across
 * both platforms: each skeleton hides its own shapes and keeps whatever is real exposed.
 *
 * The skeletons spell that hiding `aria-hidden`, not RN's `accessibilityElementsHidden` +
 * `importantForAccessibility` pair. The forms are equivalent on device — React Native's `View` reverse-maps
 * `aria-hidden` onto both — but react-native-web translates the legacy pair to NO DOM attribute, so the ARIA
 * spelling is the only one the component tier can see. That is not cosmetic: the blind spot is what let the
 * meal-plan regression ship green.
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
import { nativeTokens } from '@commise/ui/native';
import { useTheme } from '@commise/ui/theme';
import type { JSX, ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

/** Props for {@link PlaceholderWidgetCard}. */
export interface PlaceholderWidgetCardProps {
    /** The REAL widget's heading (what the viewer will eventually see here). */
    readonly title: string;
    /** The visible "Soon" badge copy. */
    readonly soonLabel: string;
    /**
     * The skeleton shape. Rendered as-is: the caller marks its own shape nodes `aria-hidden`, so a placeholder
     * whose children include something REAL (the meal-plan weekday names) can still expose it. Anything left
     * exposed here must be information the viewer genuinely has — never invented data.
     */
    readonly children: ReactNode;
}

/**
 * The shell of a roadmap skeleton placeholder (mobile): a level-1 card carrying the real widget's heading, a visible
 * "Soon" badge, and the caller's shape.
 *
 * The card is `paper` under a hairline `lineDivider` at the `sm` elevation (`buildSpec.md` §1.6), never glass: owner
 * D12 keeps glass off cards, and the translucent white tier this used had no dark value, so dark mode drew light ink
 * on light glass (`evaluateFinal.md` F1). Every colour is a role read from `useTheme()`.
 *
 * @param props - The widget `title`, the `soonLabel`, and the skeleton `children`.
 * @returns A card presenting the coming widget without inventing any of its data.
 */
export function PlaceholderWidgetCard({ title, soonLabel, children }: PlaceholderWidgetCardProps): JSX.Element {
    const { colors } = useTheme();

    return (
        <View style={[styles.card, { backgroundColor: colors.paper, borderColor: colors.lineDivider }]}>
            <View accessible accessibilityRole="header" style={styles.header}>
                <Text style={[styles.title, { color: colors.ink }]}>{title}</Text>
                <Text style={[styles.badge, { color: colors.inkMuted, borderColor: colors.lineDivider }]}>
                    {soonLabel}
                </Text>
            </View>

            {children}
        </View>
    );
}

const styles = StyleSheet.create({
    card: {
        gap: nativeTokens.spacing[4],
        borderRadius: nativeTokens.radius.md,
        borderWidth: StyleSheet.hairlineWidth,
        padding: nativeTokens.spacing[4],
        ...nativeTokens.elevation.sm,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: nativeTokens.spacing[3],
    },
    title: { ...nativeTokens.type.cardTitle, flexShrink: 1 },
    badge: {
        ...nativeTokens.type.caption,
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: nativeTokens.radius.sm,
        paddingHorizontal: nativeTokens.spacing[2],
        paddingVertical: 2,
    },
});
