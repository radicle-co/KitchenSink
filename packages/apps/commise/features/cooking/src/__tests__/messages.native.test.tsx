import { LocaleProvider, useMessages } from '@commise/i18n/react';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { cookingMessages } from '../messages.js';

/**
 * The native lane resolves the cooking copy through the same i18n path as web. It also proves this package's native
 * vitest config runs at all (react-native aliased to react-native-web, the keep-awake and safe-area stubs resolvable), so
 * the native render tests that follow have a working lane.
 */
describe('cookingMessages on the native lane', () => {
    it('resolves the English set through useMessages', () => {
        const wrapper = ({ children }: { readonly children: ReactNode }) => (
            <LocaleProvider locale="en">{children}</LocaleProvider>
        );
        const { result } = renderHook(() => useMessages(cookingMessages), { wrapper });

        expect(result.current.nav.finish).toBe('Finish');
        expect(result.current.done.cookAgain).toBe('Cook it again');
    });
});
