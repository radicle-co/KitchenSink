/**
 * Native tests for the caption under a paste control (ADR-0089), through react-native-web under jsdom. Mirrors
 * `PastedSourceNotice.test.tsx`.
 */
import { fireEvent } from '@testing-library/dom';
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { render } from '@commise/ui/testing/tamagui';
import { editorMessages } from '../../editor/messages.js';
import { PastedSourceNotice } from '../PastedSourceNotice.native.js';

afterEach(cleanup);

const TEXT = 'Source set to allrecipes.com. This recipe will be private.';

describe('PastedSourceNotice (native)', () => {
    it('says what the paste did, and offers Remove when it can be undone', () => {
        const onRemove = vi.fn();
        render(<PastedSourceNotice text={TEXT} onRemove={onRemove} />);

        expect(screen.getByText(TEXT)).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: editorMessages.en.source.snackRemove }));

        expect(onRemove).toHaveBeenCalledTimes(1);
    });

    it('offers no Remove for a note with nothing to undo', () => {
        render(<PastedSourceNotice text="Left out a Commise link. It isn’t a source." />);

        expect(screen.queryByRole('button')).toBeNull();
    });
});
