/**
 * @module home/chrome/YouTabDisc — the You tab's glyph on native: the cook's avatar as a 24 pt disc
 * (`docs/design/uiOverhaul/buildSpec.md` §3.2, owner ruling 2026-11-11, N3). The mirror of web's `YouTabDisc`, with the same
 * content rules as the chrome `Avatar` (`avatarFaceOf`): a `pearl` disc while the profile loads, the initials in a 10 pt
 * label on the `action` fill, the 20 pt outline `user` glyph with no name or after a failed read. Active, a 2 pt `ink` ring
 * stands in for the filled glyph, drawn OUTSIDE the 24 pt glyph box (an overlay, never a border), so the box is exactly the
 * icons' and the label under it shares their baseline whether the tab is selected or not.
 *
 * Decorative: the tab's own label, "You", is its accessible name (SC 2.5.3). Initials do not grow with the system text
 * size (designer ruling 2026-11-03). Styled with Tamagui only (ADR-0080).
 *
 * Mobile-local on purpose: the design system's `AvatarDisc` has a 32 pt and a 36 pt form in a closed size union, so a 24 pt
 * form is drawn here from the same face rule until the design system owns one.
 *
 * Presentational: props → JSX.
 *
 * @pattern Visitor — an exhaustive switch over the disc's three faces
 * @pattern Variant — the face and the ring are Tamagui variants, the discriminated-union render map
 */
import { YOU_TAB_DISC_SIZE, YOU_TAB_INITIALS_SIZE, initialsFor, type ProfileEntry } from '@commise/features-core';
import { avatarFaceOf } from '@commise/ui/avatar-props';
import { Icon } from '@commise/ui/icon';
import { Text } from '@commise/ui/text';
import type { JSX } from 'react';
import { styled, YStack } from 'tamagui';

/** What the disc shows (its face). */
type DiscFace = ReturnType<typeof avatarFaceOf>;

/**
 * The glyph box: exactly the icons' box, {@link YOU_TAB_DISC_SIZE} square, whatever the tab's state or the text size.
 * The ring is NOT its border (a border made it 28 and dropped the "You" label below the other three): it is the overlay
 * {@link RingMark}, laid over it from outside.
 */
const Ring = styled(YStack, {
    name: 'YouTabRing',
    width: YOU_TAB_DISC_SIZE,
    height: YOU_TAB_DISC_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
});

/** The ring itself: 2 pt, `ink` when active and transparent when not, drawn outside the glyph box so it takes no room. */
const RingMark = styled(YStack, {
    name: 'YouTabRingMark',
    position: 'absolute',
    top: -2,
    left: -2,
    right: -2,
    bottom: -2,
    borderRadius: '$full',
    borderWidth: 2,
    pointerEvents: 'none',
    variants: {
        active: {
            true: { borderColor: '$ink' },
            false: { borderColor: 'transparent' },
        },
    } as const,
});

const Disc = styled(YStack, {
    name: 'YouTabDisc',
    width: YOU_TAB_DISC_SIZE,
    height: YOU_TAB_DISC_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '$full',
    variants: {
        face: {
            blank: { backgroundColor: '$surfaceMuted' },
            initials: { backgroundColor: '$action' },
            glyph: { backgroundColor: '$surfaceMuted' },
        } as const satisfies Record<DiscFace, object>,
    } as const,
});

/** Props for {@link YouTabDisc}. */
export interface YouTabDiscProps {
    /** The profile read. */
    readonly profile: ProfileEntry;
    /** Whether the You tab is the current one: the disc takes its ink ring. */
    readonly active: boolean;
}

/**
 * The You tab's disc.
 *
 * @param props - The profile read and whether the tab is current.
 * @returns The 24 pt decorative disc inside its ring.
 */
export function YouTabDisc({ profile, active }: YouTabDiscProps): JSX.Element {
    const initials = initialsFor(profile.name);
    const face = avatarFaceOf({ status: profile.status, initials });

    return (
        <Ring aria-hidden testID="youTabRing">
            <RingMark testID="youTabRingMark" active={active} />
            <Disc testID="youTabDisc" face={face}>
                {face === 'initials' ? (
                    <Text typeRole="label" color="$onAction" fixedPx={YOU_TAB_INITIALS_SIZE}>
                        {initials}
                    </Text>
                ) : null}
                {face === 'glyph' ? <Icon name="user" size={20} tone="inkMuted" /> : null}
            </Disc>
        </Ring>
    );
}
