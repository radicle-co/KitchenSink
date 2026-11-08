/**
 * @module @commise/ui/avatar — the native avatar's disc, alone (`buildSpec.md` §3.3, §3.8): 32 pt, or the Home header's
 * `large` 36 pt disc with the small shadow and a 1 pt divider ring. Decorative: the control it sits in carries the name.
 * Colours are theme keys, so the disc follows the scheme with no hook.
 *
 * Presentational: props → JSX.
 *
 * @pattern Visitor — an exhaustive switch over the disc's three faces
 * @pattern Variant — the face and the size are Tamagui variants, the discriminated-union render map
 */
import type { FC } from 'react';
import { styled, YStack } from 'tamagui';
import { Icon } from '../icon/Icon.native.js';
import { Text } from '../text/Text.native.js';
import { nativeTokens } from '../tokens/native.js';
import { initialsPxOf } from './initialsSize.js';
import { AVATAR_DISC_PT, avatarFaceOf, type AvatarDiscProps, type AvatarSize } from './props.js';

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
            large: {
                width: AVATAR_DISC_PT.large,
                height: AVATAR_DISC_PT.large,
                borderWidth: 1,
                borderColor: '$lineDivider',
            },
        } as const satisfies Record<AvatarSize, object>,
    } as const,
});

/**
 * The large disc's shadow. It is passed as PROPS on the disc, never spread into a variant: Tamagui warns when a variant
 * sets `elevation`, and the token resolves to `elevation` alone on old Android and to `boxShadow` elsewhere, so a variant
 * could not hold it on every platform.
 */
const LARGE_SHADOW = nativeTokens.elevation.sm;

/** The disc, decorative: the control it sits in carries the name. */
export const AvatarDisc: FC<AvatarDiscProps> = ({ status, initials, size = 'default' }) => {
    const face = avatarFaceOf({ status, initials });

    return (
        <Disc aria-hidden face={face} size={size} {...(size === 'large' ? LARGE_SHADOW : {})}>
            {face === 'initials' ? (
                <Text typeRole="label" color="$onAction" fixedPx={initialsPxOf(AVATAR_DISC_PT[size])}>
                    {initials}
                </Text>
            ) : null}
            {face === 'glyph' ? <Icon name="user" size={20} tone="inkMuted" /> : null}
        </Disc>
    );
};
