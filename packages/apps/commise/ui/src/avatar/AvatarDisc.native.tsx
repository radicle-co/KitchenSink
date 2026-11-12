/**
 * @module @commise/ui/avatar — the native avatar's disc (`buildSpec.md` §3.2, §3.3, §3.8): the 32 `default` of a profile row,
 * or the 24 `tab` glyph of the You tab. Decorative: the control it sits in carries the name. Colours are theme keys, so the
 * disc follows the scheme with no hook.
 *
 * The disc is its own box, exactly 24 or 32. `active` draws a 2 `ink` ring as an OUTLINE, outside the box, never as the
 * disc's border (which made the 24 glyph 28) nor an overlay view: an outline takes no layout room, so the tab's label keeps
 * the other three's baseline.
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
        // The ring is an OUTLINE: drawn outside the disc's box, so it takes no layout room at all (a border or an
        // absolutely placed overlay both moved the tab's label on a device).
        active: {
            true: { outlineWidth: AVATAR_RING_PX, outlineColor: '$ink', outlineStyle: 'solid' },
        } as const,
    } as const,
});

/** The disc, decorative: the control it sits in carries the name. */
export const AvatarDisc: FC<AvatarDiscProps> = ({ status, initials, size = 'default', active = false }) => {
    const face = avatarFaceOf({ status, initials });

    return (
        <Disc aria-hidden testID="avatarDisc" face={face} size={size} {...(active ? { active } : {})}>
            {face === 'initials' ? (
                <Text typeRole="label" color="$onAction" fixedPx={initialsPxOf(AVATAR_DISC_PT[size])}>
                    {initials}
                </Text>
            ) : null}
            {face === 'glyph' ? <Icon name="user" size={20} tone="inkMuted" /> : null}
        </Disc>
    );
};
