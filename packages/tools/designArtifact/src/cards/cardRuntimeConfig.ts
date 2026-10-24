/**
 * @module cards/cardRuntimeConfig — what the card page tells its run-time script that is not in the card module:
 * which columns exist and which staging to apply. It crosses from Node to the page as a JSON element, never as
 * text spliced into script source. Shared by both sides, so it imports nothing from Node.
 */
import type { CardPlatforms } from './cardSpec.js';

/** The `id` of the `<script type="application/json">` element that carries the config. */
export const CARD_CONFIG_ELEMENT_ID = 'card-config';

/** What the runtime needs to know that is not in the card module itself. */
export interface CardRuntimeConfig {
    readonly platforms: CardPlatforms;
    readonly phoneViewport: boolean;
    /** Height of the per-column overlay stage, or `null` for none. */
    readonly frameHeight: number | null;
}

/**
 * Whether parsed JSON is a {@link CardRuntimeConfig}.
 *
 * @param value - Anything `JSON.parse` returned.
 * @returns A type guard.
 */
export function isCardRuntimeConfig(value: unknown): value is CardRuntimeConfig {
    if (typeof value !== 'object' || value === null) {
        return false;
    }

    const platforms: unknown = Reflect.get(value, 'platforms');
    const phoneViewport: unknown = Reflect.get(value, 'phoneViewport');
    const frameHeight: unknown = Reflect.get(value, 'frameHeight');

    return (
        (platforms === 'both' || platforms === 'web' || platforms === 'native') &&
        typeof phoneViewport === 'boolean' &&
        (frameHeight === null || typeof frameHeight === 'number')
    );
}
