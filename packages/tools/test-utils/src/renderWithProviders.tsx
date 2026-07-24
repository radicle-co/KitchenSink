import { render, type RenderResult } from '@testing-library/react';
import type { ReactElement } from 'react';

import type { Locale } from '@commise/i18n';
import { LocaleProvider } from '@commise/i18n/react';

/** Options accepted by {@link renderWithProviders}. */
export interface RenderWithProvidersOptions {
    /** The locale supplied to `LocaleProvider`. Defaults to `'en'`. */
    readonly locale?: Locale;
}

/**
 * Shared RTL custom-render helper for the Commise apps (web + mobile). Wraps `ui` in the shared
 * `LocaleProvider` — the one context every Home/app-shell component under test needs — so component tests
 * stop hand-declaring their own `<LocaleProvider>` wrapper. Returns RTL's own `render` result unchanged.
 *
 * Callers that additionally need a data/service provider (e.g. `RecipeServiceProvider`) nest it INSIDE the
 * `ui` element they pass in — `renderWithProviders(<RecipeServiceProvider client={client}><Widget /></RecipeServiceProvider>)`
 * — so this helper composes with, rather than replaces, per-feature providers.
 */
export function renderWithProviders(ui: ReactElement, options?: RenderWithProvidersOptions): RenderResult {
    const locale = options?.locale ?? 'en';

    return render(<LocaleProvider locale={locale}>{ui}</LocaleProvider>);
}
