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
        <div className="flex flex-col gap-2">
            {sourceAttribution !== undefined && sourceAttribution.length > 0 && (
                <p className="text-body-sm text-slate">
                    {fillTemplate(clone.attribution, { source: sourceAttribution })}
                </p>
            )}
            <button
                type="button"
                onClick={onClone}
                disabled={cloning || !canClone}
                aria-busy={cloning || undefined}
                className="self-start rounded-full bg-coral px-5 py-2 text-body-sm font-semibold text-white shadow-sm transition hover:opacity-90 disabled:opacity-60"
            >
                {clone.clone}
            </button>
            {cloning && (
                <span role="status" className="text-body-sm text-slate">
                    {clone.cloningLabel}
                </span>
            )}
        </div>
    );
};
