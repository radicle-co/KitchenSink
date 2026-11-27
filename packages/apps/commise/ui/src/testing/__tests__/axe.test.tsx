/**
 * The web axe check, as a component test calls it: a clean component passes, and a broken one fails with a report that
 * names the rule and the element. The broken row proves the matcher can fail at all, so a green row elsewhere means
 * "no violation found" and not "nothing was checked". jsdom cannot compute colour, so contrast is off here and on in
 * the browser spec.
 *
 * Known limit: rows below pin the wcag2a, wcag2aa and wcag21aa tags. No rule that jsdom can check carries only wcag21a,
 * so dropping that tag fails no row here. The browser spec covers it, because its known violation
 * (`label-content-name-mismatch`) is a wcag21a rule, so dropping the tag makes that entry stale and fails the spec.
 */
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Button } from '../../button/Button.js';
import { axe } from '../axe.js';

describe('the axe check', () => {
    it('passes a labelled button', async () => {
        const { container } = render(<Button variant="quiet">Save</Button>);

        expect(await axe(container)).toHaveNoViolations();
    });

    it('fails an input with no name, and the report names the rule and the element', async () => {
        const { container } = render(<input type="text" />);
        const results = await axe(container);

        expect(() => expect(results).toHaveNoViolations()).toThrow(/<input[\s\S]*Form elements must have labels/u);
    });

    it('judges the AA rules too: an input with a name but an invalid autocomplete token fails', async () => {
        const { container } = render(<input aria-label="Name" autoComplete="nope" />);
        const results = await axe(container);

        expect(() => expect(results).toHaveNoViolations()).toThrow(/autocomplete-valid/u);
    });

    it('judges the wcag2aa rules too: text in a language code that does not exist fails', async () => {
        const { container } = render(<div lang="xx-nope">Text</div>);
        const results = await axe(container);

        expect(() => expect(results).toHaveNoViolations()).toThrow(/valid-lang/u);
    });
});
