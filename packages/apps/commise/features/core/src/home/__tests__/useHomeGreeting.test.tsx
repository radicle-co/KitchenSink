// @vitest-environment jsdom
/**
 * Home's greeting hook, once for both apps: mobile's `useHomeGreeting` and the clock-and-locale reading web's
 * `HomeGreeting` repeated beside it (FR-044: the two greet identically). The clock is the viewer's LOCAL one, so each
 * case pins it; the copy and the date come from the shared catalog and formatter, so this pins how they are combined.
 */
import { LocaleProvider } from '@commise/i18n/react';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { formatHomeDate } from '../../utils/formatDate.js';
import { homeMessages } from '../messages.js';
import { useHomeGreeting } from '../useHomeGreeting.js';

const wrapper = ({ children }: { children: ReactNode }) => <LocaleProvider locale="en">{children}</LocaleProvider>;

afterEach(() => {
    vi.useRealTimers();
});

describe('useHomeGreeting', () => {
    it('greets by the viewer’s local hour, naming the cook', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 4, 31, 14, 5));

        const { result } = renderHook(() => useHomeGreeting('Eliza'), { wrapper });

        expect(result.current.title).toBe(homeMessages.en.greetingsNamed.afternoon.replace('{name}', 'Eliza'));
    });

    it('greets without a name when the cook has none yet', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 4, 31, 9, 0));

        const { result } = renderHook(() => useHomeGreeting(undefined), { wrapper });

        expect(result.current.title).toBe(homeMessages.en.greetings.morning);
    });

    it('puts the localized full date of the same instant under the title', () => {
        vi.useFakeTimers();
        const now = new Date(2026, 4, 31, 21, 30);
        vi.setSystemTime(now);

        const { result } = renderHook(() => useHomeGreeting(undefined), { wrapper });

        expect(result.current.subtitle).toBe(formatHomeDate(now, 'en'));
    });
});
