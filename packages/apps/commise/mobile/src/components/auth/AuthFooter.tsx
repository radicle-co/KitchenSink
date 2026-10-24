/**
 * @module components/auth/AuthFooter — what `AuthScreenFrame` places in its footer slot: the error line, then the
 * screen's primary action (`docs/design/uiOverhaul/buildSpec.md` §8.1). Every signed-out screen and step has the same
 * two, so the pair lives here once.
 *
 * The error goes through `LiveRegion` with `assertive` politeness: React Native's `role="alert"` is not announced on
 * iOS, and a failed sign-in is "an action the viewer just took failing". The region is mounted EMPTY when there is no
 * error, because Android announces a change to a region it already holds; empty, it takes no layout space. It is
 * `role="alert"` while it holds a message, so it sits beside the primary in whichever slot the frame chose.
 *
 * Presentational: props → JSX.
 */
import { LiveRegion } from '@commise/ui/live-region';
import { nativeTokens } from '@commise/ui/native';
import { useTheme } from '@commise/ui/theme';
import type { JSX, ReactNode } from 'react';
import { StyleSheet } from 'react-native';

/** Props for {@link AuthFooter}. */
export interface AuthFooterProps {
    /** The failure to say, or `null` for none. */
    readonly error: string | null;
    /** The primary action. */
    readonly children: ReactNode;
}

/**
 * @param props - The error and the primary.
 * @returns The error line above the primary.
 */
export function AuthFooter({ error, children }: AuthFooterProps): JSX.Element {
    const { colors } = useTheme();

    return (
        <>
            <LiveRegion politeness="assertive" style={[styles.error, { color: colors.dangerText }]}>
                {error ?? ''}
            </LiveRegion>
            {children}
        </>
    );
}

const styles = StyleSheet.create({
    error: { ...nativeTokens.type.meta },
});
