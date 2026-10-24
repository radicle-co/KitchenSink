/**
 * @module @commise/features-recipes/hooks — how every food list names a remote source and says a list of them and a
 * time, in the cook's locale (`docs/design/rowEditorOpenDecisions.md`, S7 list contract P5 and P6). The wire names a
 * source by its register id only, so the name is read from the register (`useDataSources`): its short name, else its
 * name. Source names are not translated (`ingredientSpecialization.md` §S14).
 *
 * `Intl.ListFormat` joins the names as the locale does. Hermes ships none, so the mobile app polyfills it at its entry
 * (`App.tsx`, held by `tests/intlPolyfills.test.ts`).
 *
 * @pattern Adapter — over `useDataSources`, `Intl.ListFormat` and `Intl.DateTimeFormat`, to the `SourceNaming` the list
 *     models read
 */
import { useLocale } from '@commise/i18n/react';
import { useDataSources } from '@kitchensink/food-service-client/hooks';
import { useMemo } from 'react';

import type { SourceNaming } from '../form/progressiveNotes.js';

/**
 * The surface's naming of remote sources, and how it says a time: the locale's hours and minutes.
 *
 * @returns The naming; the same object while the register and the locale stand.
 */
export function useSourceNaming(): SourceNaming {
    const locale = useLocale();
    const register = useDataSources();

    return useMemo(() => {
        const names = new Map(
            (register.data?.sources ?? []).map((source) => [source.id, source.shortName ?? source.name]),
        );
        const list = new Intl.ListFormat(locale, { type: 'conjunction' });
        const time = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' });

        return {
            sourceName: (source) => names.get(source),
            formatTime: (epochMs) => time.format(epochMs),
            formatList: (items) => list.format(items),
        };
    }, [register.data, locale]);
}
