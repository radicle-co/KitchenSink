/** Stub screens for the navigator's foot tests: each shows the foot it reads, and a task reports a height like a dock. */
import { PageFootContext, ReportPageFootContext } from '@commise/ui/popup-insets';
import { useRoute } from '@react-navigation/native';
import { useContext, useEffect, type JSX } from 'react';
import { Text, View } from 'react-native';

export const TAB_BAR = 72;

/** The tabs stub: it can measure its tab bar, and it tries to report a dock height, which a tab must ignore. */
export function TabsProbe({ onTabBarHeight }: { readonly onTabBarHeight: (height: number) => void }): JSX.Element {
    const foot = useContext(PageFootContext);
    const report = useContext(ReportPageFootContext);
    const { key } = useRoute();

    return (
        <View>
            <Text accessibilityRole="header">{`tabs foot ${String(foot)}`}</Text>
            <Text
                accessibilityRole="button"
                onPress={() => {
                    onTabBarHeight(TAB_BAR);
                }}
            >
                Measure tab bar
            </Text>
            <Text
                accessibilityRole="button"
                onPress={() => {
                    report({ routeKey: key, height: 90 });
                }}
            >
                Report 90
            </Text>
        </View>
    );
}

/**
 * A task stub with a dock: it shows the foot it reads, and reports `height` under its own route key when it is shown
 * and 0 when it goes, the way the cooking dock does. No button, so a test sees the navigator's own timing.
 */
export function DockProbe({ name, height }: { readonly name: string; readonly height: number }): JSX.Element {
    const foot = useContext(PageFootContext);
    const report = useContext(ReportPageFootContext);
    const { key } = useRoute();

    useEffect(() => {
        report({ routeKey: key, height });

        return () => {
            report({ routeKey: key, height: 0 });
        };
    }, [report, key, height]);

    return <Text accessibilityRole="header">{`${name} foot ${String(foot)}`}</Text>;
}
