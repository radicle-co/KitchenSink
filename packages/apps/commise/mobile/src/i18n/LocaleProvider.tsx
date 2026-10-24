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
 *
 * ⚠️ Twenty-three lines, one `useMemo`, renders only `children` — it reads like a render leaf and is not. It
 * is ORCHESTRATION because it is the ONE place the device's locale list becomes the app's locale: every
 * string in the app is resolved against the value decided here, and a second reader of `useLocales` would be
 * a second answer to the same question.
 *
 * @pattern Adapter over the device's locale list — projects `expo-localization`'s tags onto the shared
 *     provider's single-locale contract through the pure `resolveDeviceLocale`.
 */
export function LocaleProvider({ children }: { readonly children: ReactNode }) {
    const deviceLocales = useLocales();
    const locale = useMemo(() => resolveDeviceLocale(deviceLocales.map((entry) => entry.languageTag)), [deviceLocales]);

    return <SharedLocaleProvider locale={locale}>{children}</SharedLocaleProvider>;
}
