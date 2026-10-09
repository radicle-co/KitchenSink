/**
 * The library's list/grid choice on native, kept per device in `AsyncStorage` under the key the web cookie also uses
 * (`docs/design/uiOverhaul/buildSpec.md` §4.3). It is unknown until the store is read — the screen shows the width's
 * default meanwhile — and a choice the cook makes before the read lands wins over the stored one.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { VIEW_MODE_KEY, viewModeFrom, type ListViewMode } from '@commise/features-recipes';
import { useEffect, useState } from 'react';

/**
 * The stored choice and how to change it.
 *
 * @returns `[choice, choose]`: the choice (`undefined` until read, or when none is stored) and its setter.
 * @sideEffect Reads `AsyncStorage` once on mount; writes it on each choice. A failed read or write is ignored: a view
 * the device cannot remember is not an error worth surfacing.
 */
export function useStoredViewMode(): readonly [ListViewMode | undefined, (mode: ListViewMode) => void] {
    const [choice, setChoice] = useState<ListViewMode | undefined>(undefined);

    useEffect(() => {
        let live = true;

        AsyncStorage.getItem(VIEW_MODE_KEY)
            .then((stored) => {
                const mode = viewModeFrom(stored);

                if (live && mode !== undefined) {
                    // A choice made while the read was in flight stays.
                    setChoice((current) => current ?? mode);
                }
            })
            .catch(() => undefined);

        return () => {
            live = false;
        };
    }, []);

    const choose = (mode: ListViewMode): void => {
        setChoice(mode);
        AsyncStorage.setItem(VIEW_MODE_KEY, mode).catch(() => undefined);
    };

    return [choice, choose];
}
