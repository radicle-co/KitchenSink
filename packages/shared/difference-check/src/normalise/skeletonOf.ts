/**
 * @module @kitchensink/difference-check/normalise: the UTS #39 skeleton of one word (section 4: NFD, map, NFD), lower
 * case, because the map's targets include capitals. Stage 3 reads it to fold a look-alike quantity, stage 4 applies it
 * to every word; it lives apart so the two stages do not import each other.
 *
 * The map is Unicode's `confusables.txt` at the pinned version, through the generated module.
 *
 * Pure.
 */
import { CONFUSABLES_V1 } from '../confusables/confusablesV1.generated.js';

/**
 * The skeleton of one word.
 *
 * @param word - A word token.
 * @returns Its skeleton, lower case.
 */
export function skeletonOf(word: string): string {
    const mapped = Array.from(word.normalize('NFD'), (character) => CONFUSABLES_V1[character] ?? character).join('');

    return mapped.normalize('NFD').toLowerCase();
}
