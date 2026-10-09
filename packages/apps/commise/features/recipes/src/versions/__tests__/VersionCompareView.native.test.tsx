/**
 * The native compare sheet (build spec §6.6), REWRITTEN for slice 6 — the mirror of `VersionCompareView.test.tsx`: one
 * version against the CURRENT one, each change as what the version said and what the recipe says now, "None" for an
 * element one side lacks, and one line when they match.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { recipeMessages } from '../../messages.js';
import { makeRecipeVersion, makeSnapshot } from '../__fixtures__/index.js';
import { compareWithCurrent } from '../compare.js';
// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { VersionCompareView } from '../VersionCompareView.native.js';

afterEach(cleanup);

const lineNames = recipeMessages.en.ingredientLineName;
const old = makeRecipeVersion({ versionNumber: 3, snapshot: makeSnapshot({ title: 'Lamb', steps: [] }) });
const current = makeRecipeVersion({
    versionNumber: 5,
    snapshot: makeSnapshot({
        title: 'Slow lamb',
        steps: [{ id: 'step_1', recipeId: 'rec_1', stepNumber: 1, instruction: 'Rest.' }],
    }),
});

describe('VersionCompareView (native)', () => {
    it('titles the sheet with the version and lists each change as then and now', () => {
        render(
            <VersionCompareView
                open
                version={old}
                diff={compareWithCurrent(old, current, 'en', lineNames)}
                onClose={vi.fn()}
            />,
        );

        expect(screen.getByRole('heading', { name: 'Version 3 and the current version' })).toBeTruthy();
        expect(screen.getByText('Lamb')).toBeTruthy();
        expect(screen.getByText('Slow lamb')).toBeTruthy();
        expect(screen.getByText('Rest.')).toBeTruthy();
        expect(screen.getByText('None')).toBeTruthy();
    });

    it('says the version matches when nothing differs', () => {
        const same = makeRecipeVersion({ versionNumber: 4, snapshot: current.snapshot });
        render(
            <VersionCompareView
                open
                version={same}
                diff={compareWithCurrent(same, current, 'en', lineNames)}
                onClose={vi.fn()}
            />,
        );

        expect(screen.getByText('This version matches the current one.')).toBeTruthy();
    });

    it('closes through its close control, and renders nothing while closed', () => {
        const onClose = vi.fn();
        const { rerender } = render(
            <VersionCompareView
                open
                version={old}
                diff={compareWithCurrent(old, current, 'en', lineNames)}
                onClose={onClose}
            />,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Close compare' }));
        expect(onClose).toHaveBeenCalledTimes(1);

        rerender(<VersionCompareView open={false} onClose={onClose} />);
        expect(screen.queryByRole('heading', { name: /current version/u })).toBeNull();
    });
});
