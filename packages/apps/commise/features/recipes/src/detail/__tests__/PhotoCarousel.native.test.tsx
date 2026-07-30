/**
 * Native component tests for the {@link PhotoCarousel} leaf (W2 Task 2.2, D2), rendered via
 * react-native-web under jsdom. Mirrors the web carousel's branches — N slides, dot count, single-photo,
 * no-photo, and open/close of the Modal lightbox — so the two platform renders can't drift. RN elements are
 * queried by their `accessibilityLabel` (there is no stable role for an RN `Image`).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { makePhoto } from '../../__fixtures__/index.js';
import { PhotoCarousel } from '../PhotoCarousel.native.js';

afterEach(cleanup);

describe('PhotoCarousel (native)', () => {
    it('renders one slide image per photo, each with an accessible alt label', () => {
        render(
            <PhotoCarousel
                title="Grilled Lamb"
                photos={[
                    makePhoto({ id: 'pho_1', order: 1 }),
                    makePhoto({ id: 'pho_2', order: 2 }),
                    makePhoto({ id: 'pho_3', order: 3 }),
                ]}
            />,
        );

        expect(screen.getByLabelText('Grilled Lamb photo 1')).toBeTruthy();
        expect(screen.getByLabelText('Grilled Lamb photo 3')).toBeTruthy();
    });

    it('renders one navigation dot per photo when there is more than one', () => {
        render(
            <PhotoCarousel
                title="Grilled Lamb"
                photos={[makePhoto({ id: 'pho_1', order: 1 }), makePhoto({ id: 'pho_2', order: 2 })]}
            />,
        );

        expect(screen.getByLabelText('Photo navigation')).toBeTruthy();
        expect(screen.getAllByLabelText(/^Go to Grilled Lamb photo/)).toHaveLength(2);
    });

    it('omits the dot navigation for a single photo', () => {
        render(<PhotoCarousel title="Grilled Lamb" photos={[makePhoto({ id: 'pho_1', order: 1 })]} />);

        expect(screen.getByLabelText('Grilled Lamb photo 1')).toBeTruthy();
        expect(screen.queryByLabelText('Photo navigation')).toBeNull();
    });

    it('renders nothing when the recipe has no photos', () => {
        const { container } = render(<PhotoCarousel title="Grilled Lamb" photos={[]} />);

        expect(container.firstChild).toBeNull();
    });

    it('opens the Modal lightbox when a slide is activated, and closes it on the close control', async () => {
        const user = userEvent.setup();
        render(
            <PhotoCarousel
                title="Grilled Lamb"
                photos={[makePhoto({ id: 'pho_1', order: 1 }), makePhoto({ id: 'pho_2', order: 2 })]}
            />,
        );

        expect(screen.queryByLabelText('Close photo')).toBeNull();

        await user.click(screen.getByLabelText('Open Grilled Lamb photo 2 full screen'));

        expect(screen.getByLabelText('Close photo')).toBeTruthy();

        await user.click(screen.getByLabelText('Close photo'));

        expect(screen.queryByLabelText('Close photo')).toBeNull();
    });
});
