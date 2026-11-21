/**
 * Mint the id of a new timer: a UUIDv7, the only id the kept record takes (`keptTimerSchema`), so the timer keeps its
 * id when it is saved. The native sibling (`mintTimerId.native.ts`) feeds the generator from `expo-crypto`.
 */
import { v7 } from 'uuid';

/**
 * A new timer id.
 *
 * @returns A UUIDv7.
 * @sideEffect Draws random bytes and reads the clock.
 */
export function mintTimerId(): string {
    return v7();
}
