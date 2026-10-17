// @vitest-environment jsdom
/**
 * The editor's loading and error states sit in a `<main>` with no gutter of its own (a focused task, F15), so they
 * carry the editor's: 16 px, 24 px from 600, 32 px from 840 (`buildSpec.md` §1.2).
 */
import { EDITOR_GUTTER } from '@commise/features-recipes';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { EditorStateFrame } from '../EditorStateFrame';

afterEach(cleanup);

describe('EditorStateFrame', () => {
    it('wraps its state in the editor’s page gutter', () => {
        render(
            <EditorStateFrame>
                <p role="status">Loading</p>
            </EditorStateFrame>,
        );

        const classes = screen.getByRole('status').parentElement?.className.split(/\s+/u) ?? [];

        expect(classes).toEqual(expect.arrayContaining(['px-4', 'medium:px-6', 'nav:px-8']));
        expect(classes).toEqual(expect.arrayContaining(EDITOR_GUTTER.split(' ')));
    });
});
