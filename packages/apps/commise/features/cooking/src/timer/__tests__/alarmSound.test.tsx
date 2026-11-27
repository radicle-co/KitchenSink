/**
 * The alarm sound seam: with nothing provided a cook gets the silent sound, and a provided sound reaches the hook
 * untouched. The silent sound must accept all three calls, because a timer that fires calls `play` on whatever it
 * was given.
 */
import { cleanup, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type AlarmSound, AlarmSoundContext, NULL_ALARM_SOUND, useAlarmSound } from '../alarmSound.js';

afterEach(cleanup);

describe('NULL_ALARM_SOUND', () => {
    it('accepts prime, play and stop and returns nothing', () => {
        expect(NULL_ALARM_SOUND.prime()).toBeUndefined();
        expect(NULL_ALARM_SOUND.play()).toBeUndefined();
        expect(NULL_ALARM_SOUND.stop()).toBeUndefined();
    });
});

describe('useAlarmSound', () => {
    it('returns the silent sound when no provider is above', () => {
        const { result } = renderHook(() => useAlarmSound());

        expect(result.current).toBe(NULL_ALARM_SOUND);
    });

    it('returns the sound a provider supplies, and calls reach it', () => {
        const sound: AlarmSound = { prime: vi.fn(), play: vi.fn(), stop: vi.fn() };
        const wrapper = ({ children }: { readonly children: ReactNode }): ReactNode => (
            <AlarmSoundContext value={sound}>{children}</AlarmSoundContext>
        );
        const { result } = renderHook(() => useAlarmSound(), { wrapper });

        expect(result.current).toBe(sound);
        result.current.play();
        expect(sound.play).toHaveBeenCalledTimes(1);
        expect(sound.prime).not.toHaveBeenCalled();
        expect(sound.stop).not.toHaveBeenCalled();
    });
});
