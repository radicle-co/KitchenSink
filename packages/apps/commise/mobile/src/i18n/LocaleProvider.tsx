import { LocaleProvider as SharedLocaleProvider } from '@commise/i18n/react';
import { useLocales } from 'expo-localization';
import { useMemo, type ReactNode } from 'react';
import { I18nManager } from 'react-native';

import { resolveDeviceLocale } from './resolveLocale.js';

// Enable RTL layout support up front so a future RTL locale lays out correctly without retrofitting every
// screen (React Native best practice: call allowRTL even for an en-only app; NEVER forceRTL in production
// — it requires a full app restart and is dev/testing-only).
I18nManager.allowRTL(true);

/**
 * Detect the device locale and provide it to the tree via the shared {@link SharedLocaleProvider}, so
 * components resolve copy with `useMessages`. `useLocales` re-renders when the OS locale changes (Android;
 * iOS's list is fixed for the process). Wrap the app root in this.
 */
export function LocaleProvider({ children }: { readonly children: ReactNode }) {
    const deviceLocales = useLocales();
    const locale = useMemo(() => resolveDeviceLocale(deviceLocales.map((entry) => entry.languageTag)), [deviceLocales]);

    return <SharedLocaleProvider locale={locale}>{children}</SharedLocaleProvider>;
}
