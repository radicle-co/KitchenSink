'use client';

/**
 * @module @commise/features-recipes — the web create entry (build spec §3.4; owner decision D4; blueprint Part C slice
 * 8): "New recipe", which opens the empty editor in ONE tap. Paste lives in the editor's Ingredients section, so there
 * is no menu. After link or photo import ship, the same control opens a chooser, which gets its own SPECIFY pass.
 *
 * Three forms of the one control, by where it is drawn (display derivation, `RecipeCreateButtonProps.appearance`):
 * - `fab` (the default): the design system's floating `CreateFab`, with its rules (it shrinks on scroll, hides with the
 *   keyboard and in first run, and is gone from 840 px);
 * - `sidebar`: the expanded web sidebar's full-width primary "New recipe" (§3.2);
 * - `rail`: the collapsed sidebar's 56 px round icon button, named by its label, with a tooltip on hover and on focus
 *   that stays while hovered and that Escape dismisses (SC 1.4.13). The tooltip is for sight only; the name carries it.
 */
import { useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { CreateFab } from '@commise/ui/create-fab';
import { Icon } from '@commise/ui/icon';
import { useState, type FC } from 'react';

import { recipeMessages } from '../messages.js';
import type { RecipeCreateButtonProps } from './createButtonProps.js';

/** The collapsed rail's form. */
const RailButton: FC<{ readonly label: string; readonly onPress: () => void }> = ({ label, onPress }) => {
    const [tipDismissed, setTipDismissed] = useState(false);

    return (
        <span className="group relative inline-flex" onMouseLeave={() => setTipDismissed(false)}>
            <button
                type="button"
                aria-label={label}
                onClick={onPress}
                onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                        setTipDismissed(true);
                    }
                }}
                onBlur={() => setTipDismissed(false)}
                className="inline-flex size-14 items-center justify-center rounded-full bg-action text-on-action transition-colors hover:bg-action-pressed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2"
            >
                <Icon name="plus" size={24} />
            </button>
            <span
                aria-hidden="true"
                data-dismissed={tipDismissed ? 'true' : 'false'}
                className={`pointer-events-auto absolute start-full top-1/2 z-50 ms-2 hidden -translate-y-1/2 whitespace-nowrap rounded-md bg-inverse px-2 py-1 text-caption text-inverse-ink ${
                    tipDismissed ? '' : 'group-hover:block group-has-[:focus-visible]:block'
                }`}
            >
                {label}
            </span>
        </span>
    );
};

/** "New recipe": one tap opens the editor. */
export const RecipeCreateButton: FC<RecipeCreateButtonProps> = ({ onCreateRecipe, appearance = 'fab', firstRun }) => {
    const { list } = useMessages(recipeMessages);

    switch (appearance) {
        case 'fab':
            return (
                <CreateFab
                    label={list.createCta}
                    icon="plus"
                    onPress={onCreateRecipe}
                    {...(firstRun === undefined ? {} : { firstRun })}
                />
            );
        case 'sidebar':
            return (
                <Button icon="plus" width="fill" onPress={onCreateRecipe}>
                    {list.createCta}
                </Button>
            );
        case 'rail':
            return <RailButton label={list.createCta} onPress={onCreateRecipe} />;
    }
};
