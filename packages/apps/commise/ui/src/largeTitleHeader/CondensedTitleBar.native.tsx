/**
 * @module @commise/ui/large-title-header — the native design-system {@link CondensedTitleBar} (see `props.ts`): the
 * 56 pt PINNED bar every native pushed page lays over the top of its scroller (`PINNED_BAR_HEIGHT`). Its back control and
 * menu are always rendered and pressable; the material (Liquid Glass on iOS 26, a solid `paperRaised` surface elsewhere,
 * `ChromeSurface`) shows once the page has scrolled, and the one-line title once the large title is under the bar. It sits
 * at the top of its screen's SAFE-AREA frame, which already clears the status bar, so it adds no inset of its own
 * (measured on a device: padding the inset again drew a 56 pt bar twice as tall, below the status bar).
 *
 * ⛔ It fades by `ChromeSurface`'s own `visible` and by the TITLE's opacity, never by an opacity on this bar: an opacity
 * on a `GlassView`'s ancestor stops the glass rendering at all. Nor is it ever hidden from assistive tech or from touches
 * as a whole: the empty band is `box-none`, so a control under it (Home's avatar) still gets its taps, and the surface and
 * the title, which are not controls, take none.
 *
 * The motion is the platform's: the glass animates through its own `glassEffectStyle`, and the title's opacity changes at
 * once, which is also what Reduce Motion asks for. That is a UX concession, not a technical limit: the change is instant
 * and a fade is later polish. `ui/src/motion` has only the rise-and-fade enter transition, so a fade needs a new one; an
 * `Animated.Value` held in `useState` would do it without a ref.
 *
 * Presentational: props → JSX; `surfaceShown` and `titleShown` are display derivation.
 *
 * @pattern Composite — the back control, the title and the menu over one floating-layer material
 */
import type { FC } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ChromeSurface } from '../chromeSurface/ChromeSurface.native.js';
import { Icon } from '../icon/Icon.native.js';
import { touchFloor } from '../layout/touchFloor.native.js';
import { useContainerClass } from '../layout/useContainerClass.native.js';
import { useTheme } from '../theme/useTheme.native.js';
import { nativeTokens } from '../tokens/native.js';
import { PINNED_BAR_HEIGHT, backGlyphInset, barStartPadding } from './barGeometry.js';
import type { CondensedTitleBarProps } from './props.js';

/** How much of the bar the back control's parent name may take, as a share of its width: a judgement, not a cited figure. */
const PARENT_LABEL_MAX_WIDTH = '40%';

/** The native design-system condensed title bar. */
export const CondensedTitleBar: FC<CondensedTitleBarProps> = ({ title, back, menu, surfaceShown, titleShown }) => {
    const { colors } = useTheme();
    // From a tablet's width the control names its parent too ("‹ Collections"); a phone shows the chevron alone.
    const showsParent = useContainerClass() !== 'narrow';
    const floor = touchFloor();
    const frame = { minWidth: floor, height: floor };

    return (
        // The bar's start padding and the control's own leading room together put the chevron's box on the 16 pt content
        // gutter, on a phone (glyph centred in the frame) and on a tablet (glyph then name) alike.
        <View pointerEvents="box-none" style={[styles.bar, { paddingStart: barStartPadding(floor) }]}>
            <ChromeSurface edge="bottom" visible={surfaceShown} />
            {back === undefined ? null : (
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={back.label}
                    onPress={back.onPress}
                    style={[
                        styles.back,
                        frame,
                        showsParent
                            ? [styles.backWithParent, { paddingStart: backGlyphInset(floor) }]
                            : { width: floor },
                    ]}
                >
                    <Icon name="chevronLeft" size={24} tone="actionText" />
                    {showsParent ? (
                        <Text
                            numberOfLines={1}
                            // The control's own label names it in full; this is the parent's name for sight only.
                            aria-hidden
                            style={[styles.parentName, nativeTokens.type.label, { color: colors.actionText }]}
                        >
                            {back.parent}
                        </Text>
                    ) : null}
                </Pressable>
            )}
            {/* A View, not the Text, takes no touches: Android ignores `pointerEvents` on a Text, and the title spans the
            band over Home's avatar. */}
            <View pointerEvents="none" style={styles.title}>
                {title === undefined ? null : (
                    <Text
                        numberOfLines={1}
                        // The H1 says it; the bar repeats it for sight only.
                        aria-hidden
                        style={[nativeTokens.type.barTitle, { color: colors.ink, opacity: titleShown ? 1 : 0 }]}
                    >
                        {title}
                    </Text>
                )}
            </View>
            {menu}
        </View>
    );
};

const styles = StyleSheet.create({
    bar: {
        position: 'absolute',
        top: 0,
        start: 0,
        end: 0,
        zIndex: 10,
        height: PINNED_BAR_HEIGHT,
        flexDirection: 'row',
        alignItems: 'center',
        gap: nativeTokens.spacing[2],
        paddingEnd: nativeTokens.spacing[2],
    },
    back: { alignItems: 'center', justifyContent: 'center' },
    // The glyph stays centred in its frame on a phone; on a tablet the frame grows with the name, so the glyph's room
    // before it is added back (`backGlyphInset`) and the name follows it.
    backWithParent: { flexDirection: 'row', gap: nativeTokens.spacing[1], maxWidth: PARENT_LABEL_MAX_WIDTH },
    // Shrinks, so `numberOfLines` ellipsizes the name inside the control's 40% cap instead of overflowing it.
    parentName: { flexShrink: 1 },
    title: { flex: 1, paddingHorizontal: nativeTokens.spacing[2] },
});
