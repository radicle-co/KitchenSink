/**
 * WCAG 4.1.3 (status messages) for the web photo manager: an upload in flight, an upload that finished and an
 * upload that failed must each reach a screen-reader user without moving focus.
 *
 * The region must already exist, EMPTY, before the upload starts: a live region speaks at a change of its text, and
 * a node that mounts with its text in it is not reliably spoken (`LiveRegion`'s contract). So the start case asserts
 * the SAME element gains the text, not just that the text appears somewhere.
 *
 * Supersedes the old 'shows a busy status…' case in `RecipePhotoManager.test.tsx`, which rendered the status
 * conditionally (mounted with its text already in it) and had no case for finish.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { makeQueueItem } from '../../__fixtures__/index.js';
import { RecipePhotoManager } from '../RecipePhotoManager.js';
import type { RecipePhotoManagerProps } from '../model.js';

afterEach(cleanup);

const noop = () => undefined;
const base: RecipePhotoManagerProps = { photos: [], onRemovePhoto: noop };

const regions = (): HTMLElement[] => screen.queryAllByRole('status');
const spoken = (): string[] => regions().flatMap((region) => (region.textContent === '' ? [] : [region.textContent]));

describe('RecipePhotoManager (web) — upload announcements (WCAG 4.1.3)', () => {
    it('has its polite regions mounted and empty before anything uploads', () => {
        render(<RecipePhotoManager {...base} />);

        expect(regions().length).toBeGreaterThan(0);
        expect(spoken()).toEqual([]);
    });

    it('speaks "Uploading photo" in a region that already existed when the upload starts', () => {
        const { rerender } = render(<RecipePhotoManager {...base} />);
        const before = regions();

        rerender(<RecipePhotoManager {...base} uploading />);

        expect(spoken()).toEqual(['Uploading photo']);
        expect(before).toContain(regions().find((region) => region.textContent === 'Uploading photo'));
    });

    it('stops saying "Uploading photo" and says "Photo uploaded" when an upload finishes', () => {
        const { rerender } = render(<RecipePhotoManager {...base} uploading />);
        expect(spoken()).toEqual(['Uploading photo']);

        rerender(
            <RecipePhotoManager
                {...base}
                uploading={false}
                queueItems={[makeQueueItem({ fileId: 1, status: 'ok' })]}
            />,
        );

        expect(spoken()).toEqual(['Photo uploaded']);
    });

    it('says "Photo uploaded" again for a SECOND upload, in a region that was empty', () => {
        const one = [makeQueueItem({ fileId: 1, status: 'ok' })];
        const two = [...one, makeQueueItem({ fileId: 2, status: 'ok' })];
        const { rerender } = render(<RecipePhotoManager {...base} queueItems={one} />);
        const first = regions().find((region) => region.textContent === 'Photo uploaded');

        rerender(<RecipePhotoManager {...base} queueItems={two} />);

        const second = regions().find((region) => region.textContent === 'Photo uploaded');
        expect(second).toBeDefined();
        expect(second).not.toBe(first);
        expect(first?.textContent).toBe('');
    });

    it('does NOT say "Photo uploaded" when the upload failed — the failure alert speaks, once', () => {
        const failed = [makeQueueItem({ fileId: 1, fileName: 'a.png', status: 'failed', retryable: true })];
        const { rerender } = render(<RecipePhotoManager {...base} uploading />);

        rerender(<RecipePhotoManager {...base} uploading={false} queueItems={failed} errorMessage="Upload failed." />);

        expect(spoken()).toEqual([]);
        expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
    });
});
