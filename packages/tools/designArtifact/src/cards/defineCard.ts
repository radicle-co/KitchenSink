/**
 * @module cards/defineCard — the one constructor of a card, so inference of the `uses` tuple types `render`.
 */
import type { CardComponentName } from './cardComponents.js';
import type { CardSpec } from './cardSpec.js';

/**
 * Declares a card. Identity at run time; its job is the type: `Used` is inferred from `uses`, so `render` receives
 * exactly those components, each with its real props.
 *
 * @param spec - The card.
 * @returns The same object.
 */
export function defineCard<const Used extends CardComponentName>(spec: CardSpec<Used>): CardSpec<Used> {
    return spec;
}
