/** Component tests for the internal web `Spinner`, shared by `Button`'s busy glyph and `LoadingNotice`. */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Button } from '../../button/Button.js';
import { Spinner } from '../Spinner.js';

afterEach(cleanup);

describe('Spinner', () => {
    it('is a decorative 20 px arc that takes the colour of its context', () => {
        const { container } = render(<Spinner className="animate-spin" />);
        const svg = container.querySelector('svg');

        expect(svg?.getAttribute('aria-hidden')).toBe('true');
        expect(svg?.getAttribute('width')).toBe('20');
        expect(svg?.getAttribute('height')).toBe('20');
        expect(container.querySelector('path')?.getAttribute('stroke')).toBe('currentColor');
    });

    it('applies the spin class its caller chooses', () => {
        const { container } = render(<Spinner className="motion-safe:animate-spin" />);

        expect(container.querySelector('svg')?.getAttribute('class')).toBe('motion-safe:animate-spin');
    });

    it('⛔ Button’s busy spinner still spins unconditionally after the extraction', () => {
        const { container } = render(
            <Button variant="ghost" busy>
                Save
            </Button>,
        );

        expect(container.querySelector('svg')?.getAttribute('class')).toBe('animate-spin');
    });

    it('is in rem, so browser text size moves it, only when it stands beside a label', () => {
        const alone = render(<Spinner className="animate-spin" />);

        expect(alone.container.querySelector('svg')?.style.width).toBe('');
        cleanup();

        const beside = render(<Spinner className="animate-spin" scaleWith={{ role: 'cardTitle' }} />);

        expect(beside.container.querySelector('svg')?.style.width).toBe('1.25rem');
        expect(beside.container.querySelector('svg')?.style.height).toBe('1.25rem');
    });

    it('is the one in a busy Button, which grows with the button label like its glyph', () => {
        const { container } = render(
            <Button icon="plus" busy>
                Save
            </Button>,
        );

        expect(container.querySelector('svg')?.style.width).toBe('1.25rem');
    });
});
