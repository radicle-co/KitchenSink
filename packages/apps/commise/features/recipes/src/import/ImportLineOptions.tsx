'use client';

/**
 * @module @commise/features-recipes/import — `ImportLineOptions`: one line's options, the same list wherever a line is
 * chosen for — the wizard's open line, the flagged pane at 1194 and on web, and the flagged sheet on phone and 834
 * (`ingredientMatching.md`). "Search for a food" first (owner ruling I1: a shortlist or a default never replaces search),
 * then the server's candidates with the default tagged and never chosen, then "Keep … as written" as the last row of
 * the same list.
 *
 * ONE component for both platforms: it composes only design-system parts (`Button`, `RadioList`), which resolve to
 * their web or native leaf at bundle time, and returns them as siblings for the host's column to space.
 *
 * Presentational and controlled: the host holds the pick and opens search.
 *
 * @pattern Adapter over the design-system `RadioList` — a line's candidates and the keep row as option rows, a row id
 *     back as an `ImportLinePick` (`importLine.ts`)
 */
import { useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { RadioList } from '@commise/ui/radio-list';
import type { FC } from 'react';

import { fillTemplate } from '../format/fillTemplate.js';
import { lineOptionsOf, optionValueOf, pickOfOptionValue } from './importLine.js';
import { importMessages } from './messages.js';
import type { ImportLineOptionsProps } from './props.js';

/** One line's options: search first, then the foods, then keep as written. */
export const ImportLineOptions: FC<ImportLineOptionsProps> = ({ lineText, candidates, pick, onPick, onSearch }) => {
    const { line: m } = useMessages(importMessages);

    return (
        <>
            <Button
                variant="secondary"
                icon="search"
                width="fill"
                accessibilityLabel={fillTemplate(m.searchName, { line: lineText })}
                onPress={onSearch}
            >
                {m.search}
            </Button>
            <RadioList
                label={fillTemplate(m.optionsLabel, { line: lineText })}
                look="rows"
                options={lineOptionsOf(lineText, candidates, m)}
                value={optionValueOf(pick)}
                onChange={(id) => {
                    const picked = pickOfOptionValue(id, candidates);

                    if (picked !== undefined) {
                        onPick(picked);
                    }
                }}
            />
        </>
    );
};
