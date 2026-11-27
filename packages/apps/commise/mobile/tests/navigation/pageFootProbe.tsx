/** The tabs stub for the navigator's foot tests. */
import { PageFootContext, ReportPageFootContext } from '@commise/ui/popup-insets';
import { useRoute } from '@react-navigation/native';
import { useContext, type JSX } from 'react';
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
