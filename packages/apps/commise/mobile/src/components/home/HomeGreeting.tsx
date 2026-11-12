/**
 * @module home/HomeGreeting — Home's header on native (US-000 / FR-046; `docs/design/uiOverhaul/buildSpec.md` §4.2): ONE
 * row. The greeting ("Good afternoon, Eliza"; "Good afternoon" without a name) and the local date stack on the start
 * side, and nothing sits on the end side: no title row carries the avatar (owner ruling 2026-11-11, N3).
 *
 * It is no longer the shared `LargeTitleHeader`: Home's greeting is a `cardTitle`, not a large title, and the condensed
 * bar that echoed a large title is gone from Home (designer, 2026-11-02). Both lines derive from the viewer's local
 * clock via the SHARED `useHomeGreeting` in `@commise/features-core/home`, so web and mobile greet identically
 * (FR-044). The surface is client-rendered on device, so (unlike web) there is no hydration concern.
 *
 * Presentational once the greeting is read: the layout is Tamagui stacks, the colours are theme keys.
 */
import { useHomeGreeting } from '@commise/features-core/home';
import { nativeTokens } from '@commise/ui/native';
import { Text } from '@commise/ui/text';
import type { JSX } from 'react';
import { XStack, YStack } from 'tamagui';

/**
 * The header's own side inset, pt: it owns it, so a screen cannot forget it (bug sweep B11). Both sides are written out because
 * `paddingHorizontal` compiles to `padding-inline`, which jsdom cannot read back, and the inset test measures the left
 * side. The two are equal, so a right-to-left layout is the same.
 */
const SIDE_INSET = nativeTokens.spacing[4];

/** Clear space above the row, pt: with the region's own 8, the 40 the boards draw under the status bar. */
const TOP_GAP = 32;

/** Props for {@link HomeGreeting}. */
export interface HomeGreetingProps {
    /** The cook's display name, if any. */
    readonly name?: string;
}

/**
 * Home's header (native).
 *
 * @param props - The cook's name.
 * @returns The greeting over the date.
 */
export function HomeGreeting({ name }: HomeGreetingProps = {}): JSX.Element {
    const { title, subtitle } = useHomeGreeting(name);

    return (
        <XStack
            alignItems="center"
            gap="$3"
            marginTop={TOP_GAP}
            marginBottom={nativeTokens.spacing[2]}
            paddingLeft={SIDE_INSET}
            paddingRight={SIDE_INSET}
        >
            {/* Takes the free width and wraps, so a long name or a large text size never pushes the button away. */}
            <YStack flex={1} flexShrink={1} minWidth={0}>
                <Text role="heading" typeRole="cardTitle" color="$ink">
                    {title}
                </Text>
                <Text typeRole="body" color="$inkMuted">
                    {subtitle}
                </Text>
            </YStack>
        </XStack>
    );
}
