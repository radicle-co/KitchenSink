'use client';

/**
 * React binding for `@commise/i18n` — a locale context + hooks shared by web (client components) and
 * mobile. Next.js SERVER components must not use this (context is client-only); they resolve dictionaries
 * directly via `getDictionary(locale)` + `resolveMessages`. The `'use
 * client'` directive marks this a client module for Next; React Native ignores it.
 */
import { createContext, useContext, type ReactNode } from 'react';

import { resolveMessages, type LocalizedMessages } from './dictionary.js';
import { DEFAULT_LOCALE, type Locale } from './locales.js';

const LocaleContext = createContext<Locale>(DEFAULT_LOCALE);

/** Provide the active locale to the subtree. Web sets it from the `[locale]` route; mobile from the device. */
export function LocaleProvider({ locale, children }: { readonly locale: Locale; readonly children: ReactNode }) {
    return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

/** The active locale from the nearest {@link LocaleProvider} (or {@link DEFAULT_LOCALE} if none). */
export function useLocale(): Locale {
    return useContext(LocaleContext);
}

/** Resolve a shared dictionary for the active locale (falling back to the default set). */
export function useMessages<T>(messages: LocalizedMessages<T>): T {
    return resolveMessages(messages, useLocale());
}
