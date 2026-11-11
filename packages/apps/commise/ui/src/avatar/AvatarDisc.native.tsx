/**
 * @module @commise/ui/avatar — the native avatar's disc (`buildSpec.md` §3.2, §3.3, §3.8): the 32 `default` of a profile row,
 * or the 24 `tab` glyph of the You tab. Decorative: the control it sits in carries the name. Colours are theme keys, so the
 * disc follows the scheme with no hook.
 *
 * The disc sits in a box of exactly its own size. `active` draws a 2 `ink` ring as an overlay laid OUTSIDE that box, never
 * as the disc's border: a border made the 24 glyph 28 and dropped the tab's label below the other three. The overlay takes
 * no layout room.
 *
 * Presentational: props → JSX.
 *
 * @pattern Visitor — an exhaustive switch over the disc's three faces
 * @pattern Variant — the face, the size and the ring are Tamagui variants, the discriminated-union render map
 */
import type { FC } from 'react';
import { styled, YStack } from 'tamagui';
import { Icon } from '../icon/Icon.native.js';
import { Text } from '../text/Text.native.js';
import { initialsPxOf } from './initialsSize.js';
import { AVATAR_DISC_PT, AVATAR_RING_PX, avatarFaceOf, type AvatarDiscProps, type AvatarSize } from './props.js';

/** What the disc shows (its face). */
type DiscFace = ReturnType<typeof avatarFaceOf>;

/** The box the disc sits in: exactly the disc's size, so the ring and the face add nothing to it. */
const Box = styled(YStack, {
    name: 'AvatarBox',
    alignItems: 'center',
    justifyContent: 'center',
    variants: {
        size: {
            default: { width: AVATAR_DISC_PT.default, height: AVATAR_DISC_PT.default },
            tab: { width: AVATAR_DISC_PT.tab, height: AVATAR_DISC_PT.tab },
        } as const satisfies Record<AvatarSize, object>,
    } as const,
});

/** The ring: laid over the box from outside it, `ink` when active and transparent when not. */
const Ring = styled(YStack, {
    name: 'AvatarRing',
    position: 'absolute',
    top: -AVATAR_RING_PX,
    left: -AVATAR_RING_PX,
    right: -AVATAR_RING_PX,
    bottom: -AVATAR_RING_PX,
    borderRadius: '$full',
    borderWidth: AVATAR_RING_PX,
    pointerEvents: 'none',
    variants: {
        active: {
            true: { borderColor: '$ink' },
            false: { borderColor: 'transparent' },
        },
    } as const,
});

const Disc = styled(YStack, {
    name: 'AvatarDisc',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '$full',
    variants: {
        face: {
            blank: { backgroundColor: '$surfaceMuted' },
            initials: { backgroundColor: '$action' },
            glyph: { backgroundColor: '$surfaceMuted' },
        } as const satisfies Record<DiscFace, object>,
        size: {
            default: { width: AVATAR_DISC_PT.default, height: AVATAR_DISC_PT.default },
            tab: { width: AVATAR_DISC_PT.tab, height: AVATAR_DISC_PT.tab },
        } as const satisfies Record<AvatarSize, object>,
    } as const,
});

/** The disc, decorative: the control it sits in carries the name. */
export const AvatarDisc: FC<AvatarDiscProps> = ({ status, initials, size = 'default', active = false }) => {
    const face = avatarFaceOf({ status, initials });

    return (
        <Box aria-hidden testID="avatarBox" size={size}>
            <Ring testID="avatarRing" active={active} />
            <Disc testID="avatarDisc" face={face} size={size}>
                {face === 'initials' ? (
                    <Text typeRole="label" color="$onAction" fixedPx={initialsPxOf(AVATAR_DISC_PT[size])}>
                        {initials}
                    </Text>
                ) : null}
                {face === 'glyph' ? <Icon name="user" size={20} tone="inkMuted" /> : null}
            </Disc>
        </Box>
    );
};
