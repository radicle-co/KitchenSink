/**
 * @module @commise/features-recipes/form — the polite message that announces a settled lookup retry (V1 sign-off 3c):
 * `{food} is matched. Its nutrition now counts.` for a match, `{food}: {status}` for any other outcome. Shared by both
 * leaves so the two cannot announce differently. Pure.
 */
import { lineDisplayName } from '../detail/lineName.js';
import { fillTemplate } from '../format/fillTemplate.js';
import type { IngredientLineNameMessages } from '../messages.js';
import type { LookupRetry } from './ingredientStatus.js';
import type { RecipeFormMessages } from './messages.js';
import { resolutionStatusWordKey } from './statusWord.js';
import type { RecipeFormValues } from './values.js';

/**
 * The announcement for the latest settled retry, or `''` when there is none (or its line is gone).
 *
 * @param messages - The form copy for the active locale.
 * @param values - The editor's draft.
 * @param settled - The latest settled retry (`LookupRetry.settled`).
 * @param standIns - The stand-ins for a line with no name.
 * @returns The message.
 */
export const lookupSettledMessage = (
    messages: RecipeFormMessages,
    values: RecipeFormValues,
    settled: LookupRetry['settled'],
    standIns: IngredientLineNameMessages,
): string => {
    if (settled === undefined) {
        return '';
    }

    // By the row's key, never its binding: the answer that settled it may have moved it to another one.
    const line = values.ingredients.find((candidate) => candidate.key === settled.lineKey);

    if (line === undefined) {
        return '';
    }

    const food = lineDisplayName({ ...line, resolutionStatus: settled.status }, standIns);

    return settled.status === 'RESOLVED'
        ? fillTemplate(messages.statusResolvedConfirmation, { food })
        : fillTemplate(messages.statusLookupSettled, {
              food,
              status: messages[resolutionStatusWordKey(settled.status)],
          });
};
