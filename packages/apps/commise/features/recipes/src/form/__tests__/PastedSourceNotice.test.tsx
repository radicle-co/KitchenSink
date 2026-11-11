// @vitest-environment jsdom
/**
 * The caption under a paste control that says what a pasted link did (ADR-0089). A sighted cook gets the same words the
 * live region speaks, and, when the paste made the recipe private, a Remove that undoes it without leaving the paste
 * control. Presentational: text in, a button out.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { editorMessages } from '../../editor/messages.js';
import { PastedSourceNotice } from '../PastedSourceNotice.js';

afterEach(cleanup);

const TEXT = 'Source set to allrecipes.com. This recipe will be private.';

describe('PastedSourceNotice (web)', () => {
    it('says what the paste did, and offers Remove when it can be undone', async () => {
        const user = userEvent.setup();
        const onRemove = vi.fn();
        render(<PastedSourceNotice text={TEXT} onRemove={onRemove} />);

        expect(screen.getByText(TEXT)).toBeTruthy();

        await user.click(screen.getByRole('button', { name: editorMessages.en.source.snackRemove }));

        expect(onRemove).toHaveBeenCalledTimes(1);
    });

    it('offers no Remove for a note with nothing to undo', () => {
        render(<PastedSourceNotice text="Left out a Commise link. It isn’t a source." />);

        expect(screen.getByText(/Left out a Commise link/u)).toBeTruthy();
        expect(screen.queryByRole('button')).toBeNull();
    });
});
