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
 * - `rail`: the collapsed sidebar's 56 px round icon button, named by its label, with the design system's `Tooltip` on
 *   hover and on focus that stays while hovered and that Escape dismisses (SC 1.4.13). The tooltip is for sight only; the
 *   name carries it.
 */
import { useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { CreateFab } from '@commise/ui/create-fab';
import { Icon } from '@commise/ui/icon';
import { Tooltip } from '@commise/ui/tooltip';
import type { FC } from 'react';

import { recipeMessages } from '../messages.js';
import type { RecipeCreateButtonProps } from './createButtonProps.js';

/**
 * The collapsed rail's form. The tooltip is the design system's, in a portal: the rail clips anything past its edge, and
 * the in-flow tip this replaced was a 4 px sliver on hover and invisible on focus (W-02). Its hover, focus-visible,
 * Escape and hoverable rules (SC 1.4.13) are the primitive's.
 */
const RailButton: FC<{ readonly label: string; readonly onPress: () => void }> = ({ label, onPress }) => (
    <Tooltip label={label} side="end">
        <button
            type="button"
            aria-label={label}
            onClick={onPress}
            className="inline-flex size-14 items-center justify-center rounded-full bg-action text-on-action transition-colors hover:bg-action-pressed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2"
        >
            <Icon name="plus" size={24} />
        </button>
    </Tooltip>
);

/** "New recipe": one tap opens the editor. */
export const RecipeCreateButton: FC<RecipeCreateButtonProps> = ({ onCreateRecipe, appearance = 'fab', yielded }) => {
    const { list } = useMessages(recipeMessages);

    switch (appearance) {
        case 'fab':
            return (
                <CreateFab
                    label={list.createCta}
                    icon="plus"
                    onPress={onCreateRecipe}
                    {...(yielded === undefined ? {} : { yielded })}
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
