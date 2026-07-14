// @vitest-environment jsdom
/**
 * Component tests for the web recipe photo manager (T067). Covers every state the block renders — empty,
 * populated (grid + per-photo remove), a per-photo removing-busy state, the upload-in-flight status, the
 * error alert, and the add-control visibility around the photo cap. Assertions are on role/label/text and
 * mock-call args, so a wrong branch or dropped handler argument fails the test.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';

import { makePhoto } from '../../__fixtures__/index.js';
import { RecipePhotoManager } from '../RecipePhotoManager.js';
import { MAX_RECIPE_PHOTOS, type RecipePhotoManagerProps } from '../model.js';

afterEach(cleanup);

const noop = () => undefined;

function renderManager(overrides: Partial<RecipePhotoManagerProps> = {}) {
    const props: RecipePhotoManagerProps = {
        photos: [],
        onRemovePhoto: noop,
        ...overrides,
    };
    render(<RecipePhotoManager {...props} />);

    return props;
}

const threePhotos = [
    makePhoto({ id: 'ph_1', url: 'https://cdn.example/1.jpg', order: 1 }),
    makePhoto({ id: 'ph_2', url: 'https://cdn.example/2.jpg', order: 2 }),
    makePhoto({ id: 'ph_3', url: 'https://cdn.example/3.jpg', order: 3 }),
];

describe('RecipePhotoManager (web) — chrome + empty', () => {
    it('always renders the heading', () => {
        renderManager();
        expect(screen.getByRole('heading', { name: 'Photos' })).toBeTruthy();
    });

    it('shows the empty message when there are no photos', () => {
        renderManager({ photos: [] });
        expect(screen.getByText('No photos yet.')).toBeTruthy();
    });
});

describe('RecipePhotoManager (web) — populated', () => {
    it('renders one image + remove button per photo, with indexed accessible names', () => {
        renderManager({ photos: threePhotos });

        const list = screen.getByRole('list');
        expect(within(list).getAllByRole('listitem')).toHaveLength(3);
        expect(screen.getByRole('img', { name: 'Recipe photo 1' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Remove photo 3' })).toBeTruthy();
    });

    it('reports the photo id to remove upward', () => {
        const onRemovePhoto = vi.fn();
        renderManager({ photos: threePhotos, onRemovePhoto });

        fireEvent.click(screen.getByRole('button', { name: 'Remove photo 2' }));

        expect(onRemovePhoto).toHaveBeenCalledWith('ph_2');
    });

    it('busies and disables only the photo whose removal is in flight', () => {
        renderManager({ photos: threePhotos, removingPhotoId: 'ph_2' });

        expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Remove photo 2' }).disabled).toBe(true);
        expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Remove photo 1' }).disabled).toBe(false);
    });
});

describe('RecipePhotoManager (web) — upload + error states', () => {
    it('shows a busy status while an upload is in flight', () => {
        renderManager({ uploading: true });
        expect(screen.getByRole('status', { name: 'Uploading photo' })).toBeTruthy();
    });

    it('shows an alert when an error message is present', () => {
        renderManager({ errorMessage: 'That file is too large.' });
        expect(screen.getByRole('alert').textContent).toContain('That file is too large.');
    });
});

describe('RecipePhotoManager (web) — add control + cap', () => {
    it('renders the add control below the cap', () => {
        renderManager({ photos: threePhotos, addControl: <button type="button">Add photo</button> });
        expect(screen.getByRole('button', { name: 'Add photo' })).toBeTruthy();
    });

    it('hides the add control and shows the cap notice at the photo limit', () => {
        const photos = Array.from({ length: MAX_RECIPE_PHOTOS }, (_unused, index) =>
            makePhoto({ id: `ph_${index}`, order: index + 1 }),
        );
        renderManager({ photos, addControl: <button type="button">Add photo</button> });

        expect(screen.queryByRole('button', { name: 'Add photo' })).toBeNull();
        expect(screen.getByText(`Maximum of ${MAX_RECIPE_PHOTOS} photos reached.`)).toBeTruthy();
    });
});
