/**
 * @module @commise/features-recipes/editor — the native Ready line of Photos & publish; the mirror of
 * `PublishLine.tsx`. Plain text when ready, a ghost button to the first section that needs it otherwise.
 *
 * Presentational: props → JSX.
 */
import { Button } from '@commise/ui/button';
import { nativeTokens } from '@commise/ui/native';
import { useTheme } from '@commise/ui/theme';
import type { FC } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { PublishLineProps } from './PublishLine.js';

/** The native Ready line. */
export const PublishLine: FC<PublishLineProps> = ({ line, onJump }) => {
    const { colors } = useTheme();

    return line.kind === 'ready' ? (
        <Text style={[styles.ready, { color: colors.inkMuted }]}>{line.text}</Text>
    ) : (
        <View style={styles.fix}>
            <Button variant="ghost" icon="triangleAlert" onPress={() => onJump(line.section)}>
                {line.text}
            </Button>
        </View>
    );
};

const styles = StyleSheet.create({
    ready: { ...nativeTokens.type.meta },
    fix: { alignItems: 'flex-start' },
});
