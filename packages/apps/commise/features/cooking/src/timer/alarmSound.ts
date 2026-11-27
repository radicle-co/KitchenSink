/**
 * @module alarmSound — the sound a firing timer makes, as a seam. The cooking screen asks for a sound through
 * `useAlarmSound` and never learns where it comes from, so the real sound can arrive later without a change here.
 *
 * @pattern Null Object + Dependency Injection through a React context — the default is a sound that does nothing, so
 *     a screen with no provider (a test, a platform with no sound yet) calls it safely
 */
import { createContext, useContext } from 'react';

/** The three things a timer asks of its sound. */
export interface AlarmSound {
    /** Get the sound ready. Called from a cook's tap, because a device may refuse to start sound without one. */
    prime(): void;
    /** Start the alarm. */
    play(): void;
    /** Stop the alarm. Safe to call when it is not playing. */
    stop(): void;
}

/** The sound that does nothing. */
export const NULL_ALARM_SOUND: AlarmSound = {
    prime: () => undefined,
    play: () => undefined,
    stop: () => undefined,
};

/** The session's alarm sound. The default is the silent one. */
export const AlarmSoundContext = createContext<AlarmSound>(NULL_ALARM_SOUND);

/** The alarm sound of the session: the provided one, else `NULL_ALARM_SOUND`. */
export function useAlarmSound(): AlarmSound {
    return useContext(AlarmSoundContext);
}
