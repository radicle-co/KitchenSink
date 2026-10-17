/**
 * @module cards/browser/readCardConfig — reads the config the card page carries as a JSON element.
 */
import { CARD_CONFIG_ELEMENT_ID, isCardRuntimeConfig } from '../cardRuntimeConfig.js';
import type { CardRuntimeConfig } from '../cardRuntimeConfig.js';

/**
 * @param doc - The card page's document.
 * @returns The parsed, checked config.
 * @throws Error when the element is missing or does not hold a config.
 */
export function readCardConfig(doc: Document): CardRuntimeConfig {
    const element = doc.getElementById(CARD_CONFIG_ELEMENT_ID);

    if (element === null) {
        throw new Error(`The card page has no #${CARD_CONFIG_ELEMENT_ID} element.`);
    }

    const config: unknown = JSON.parse(element.textContent);

    if (!isCardRuntimeConfig(config)) {
        throw new Error(`#${CARD_CONFIG_ELEMENT_ID} does not hold a card config.`);
    }

    return config;
}
