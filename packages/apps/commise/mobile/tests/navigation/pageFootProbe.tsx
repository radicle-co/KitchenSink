/** A stub screen for the navigator's foot tests: it shows the foot it reads and has buttons to report a height. */
import { PageFootContext, ReportPageFootContext } from '@commise/ui/popup-insets';
import { useContext, type JSX } from 'react';
import { Text, View } from 'react-native';

/** The heights the stub's buttons report. */
export const REPORTS = [90, 10, 0] as const;

export const TAB_BAR = 72;

/** @param props - The screen's name, and for the tabs stub the callback that measures the tab bar. */
export function Probe({
    name,
    tabBar,
}: {
    readonly name: string;
    readonly tabBar?: (height: number) => void;
}): JSX.Element {
    const foot = useContext(PageFootContext);
    const report = useContext(ReportPageFootContext);

    return (
        <View>
            <Text accessibilityRole="header">{`${name} foot ${foot}`}</Text>
            {tabBar === undefined ? null : (
                <Text accessibilityRole="button" onPress={() => tabBar(TAB_BAR)}>
                    Measure tab bar
                </Text>
            )}
            {REPORTS.map((height) => (
                <Text key={height} accessibilityRole="button" onPress={() => report(height)}>
                    {`Report ${height}`}
                </Text>
            ))}
        </View>
    );
}
