/**
 * @module @commise/features-recipes — web recipe clone action (T075 building block).
 *
 * Controlled, presentational clone button plus optional source-attribution line. The button is disabled when
 * cloning is not allowed (`!canClone`) or a clone is in flight (`cloning`), and marked busy while cloning so
 * it cannot be double-submitted. The attribution line renders only when `sourceAttribution` is present. It
 * performs NO mutation — the composing app wires the clone mutation to `onClone`.
 */
import { useMessages } from '@commise/i18n/react';
import type { FC } from 'react';

import { fillTemplate } from '../list/model.js';
import { recipeActionMessages } from './messages.js';
import type { RecipeCloneActionProps } from './model.js';

export const RecipeCloneAction: FC<RecipeCloneActionProps> = ({
    canClone,
    sourceAttribution,
    cloning = false,
    onClone,
}) => {
    const { clone } = useMessages(recipeActionMessages);

    return (
        <div>
            {sourceAttribution !== undefined && sourceAttribution.length > 0 && (
                <p>{fillTemplate(clone.attribution, { source: sourceAttribution })}</p>
            )}
            <button type="button" onClick={onClone} disabled={cloning || !canClone} aria-busy={cloning || undefined}>
                {clone.clone}
            </button>
            {cloning && <span role="status">{clone.cloningLabel}</span>}
        </div>
    );
};
