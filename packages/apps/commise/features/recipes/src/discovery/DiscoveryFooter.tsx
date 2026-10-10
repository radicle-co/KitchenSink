'use client';

/**
 * @module @commise/features-recipes/discovery — the web footer of a Discover card (`docs/design/uiOverhaul/buildSpec.md`
 * §4.1): a 20 px avatar disc, "@handle" on one line (or "From {source}" for an imported recipe with no author), and a
 * 44 px Save a copy icon button at the end.
 *
 * The button's state is the copy's (`useSaveCopy`): the glyph fills while a copy is being made and stays filled once it
 * exists, a press while saving or saved sends nothing, and a failure unfills it and says so in an inline alert under the
 * row. It is `aria-disabled` rather than `disabled` while saving or saved, so it stays in the tab order and a keyboard
 * cook who just pressed it does not lose their place.
 *
 * Presentational: it holds no state and sends nothing; the card lifts it above its link (`RecipeCard`'s `footer` slot).
 */
import { useMessages } from '@commise/i18n/react';
import { Icon } from '@commise/ui/icon';
import type { FC } from 'react';

import { recipeActionMessages } from '../actions/messages.js';
import { fillTemplate } from '../format/fillTemplate.js';
import { discoveryMessages } from './messages.js';
import type { DiscoveryFooterProps } from './model.js';

/** The 44 px icon button. A busy or finished copy keeps the focus ring: the control is inert, not gone. */
const BUTTON =
    'inline-flex size-11 shrink-0 items-center justify-center rounded-full hover:bg-ink/6 focus-visible:outline-none ' +
    'focus-visible:ring-2 focus-visible:ring-focus-ring';

export const DiscoveryFooter: FC<DiscoveryFooterProps> = ({
    title,
    authorHandle,
    sourceAttribution,
    state,
    onSave,
}) => {
    const copy = useMessages(recipeActionMessages).saveCopy;
    const discovery = useMessages(discoveryMessages);
    const inert = state.kind === 'saving' || state.kind === 'saved';
    const name = fillTemplate(
        state.kind === 'saving' ? copy.saving : state.kind === 'saved' ? copy.done : copy.button,
        { title },
    );
    const by =
        authorHandle !== undefined
            ? fillTemplate(discovery.authorHandle, { handle: authorHandle })
            : sourceAttribution === undefined
              ? undefined
              : fillTemplate(discovery.attribution, { source: sourceAttribution });

    return (
        <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
                {authorHandle === undefined ? null : (
                    <span
                        aria-hidden="true"
                        className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-selected-fill text-overline text-action-text"
                    >
                        {authorHandle.slice(0, 1).toUpperCase()}
                    </span>
                )}
                <span className="min-w-0 flex-1 truncate text-meta text-ink-muted">{by}</span>
                <button
                    type="button"
                    aria-label={name}
                    aria-disabled={inert || undefined}
                    aria-busy={state.kind === 'saving' || undefined}
                    onClick={() => {
                        if (!inert) {
                            onSave();
                        }
                    }}
                    className={`${BUTTON} ${inert ? 'text-action-text' : 'text-ink-muted hover:text-ink'}`}
                >
                    <Icon name="copyPlus" size={24} filled={inert} />
                </button>
            </div>
            {state.kind === 'failed' ? (
                <p role="alert" className="text-meta text-danger-text">
                    {copy.failed}
                </p>
            ) : null}
        </div>
    );
};
