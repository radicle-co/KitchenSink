/** A task stub for the navigator's foot tests: it shows the foot it reads, and reports a height like a dock. */
import { PageFootContext, ReportPageFootContext } from '@commise/ui/popup-insets';
import { useRoute } from '@react-navigation/native';
import { useContext, useEffect, type JSX } from 'react';
import { Text } from 'react-native';

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
