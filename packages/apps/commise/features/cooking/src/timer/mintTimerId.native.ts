/**
 * The native timer id. Hermes has no `crypto` global, so the random bytes come from `expo-crypto`, as the event-id
 * minter's native leaf does (`@commise/features-recipes` `mintEventId.native.ts`).
 */
import { getRandomBytes } from 'expo-crypto';
import { v7 } from 'uuid';

/**
 * A new timer id.
 *
 * @returns A UUIDv7.
 * @sideEffect Draws 16 random bytes from the device and reads the clock.
 */
export function mintTimerId(): string {
    return v7({ random: getRandomBytes(16) });
}
