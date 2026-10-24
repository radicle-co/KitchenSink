/**
 * WCAG 4.1.3 (status messages) for the NATIVE photo manager, in lock-step with the web leaf's
 * `photoUploadAnnouncement.test.tsx`: an upload in flight, finished or failed must reach a screen-reader user.
 *
 * Native had a `progressbar` with no live region: nothing spoke between choosing a photo and the result
 * (`parityAudit2026-10-17.md` G3 / 4.1.3). The channel is `LiveRegion`'s: Android speaks a live-region text change on
 * its own; iOS has no live region, so it is handed an imperative announcement. `Platform.OS` and the announce API are
 * mocked because react-native-web implements neither. Supersedes the old 'busy status' progressbar case in
 * `RecipePhotoManager.native.test.tsx`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { AccessibilityInfo } from 'react-native';

import { makeQueueItem } from '../../__fixtures__/index.js';
import { RecipePhotoManager } from '../RecipePhotoManager.native.js';
import type { RecipePhotoManagerProps } from '../model.js';

const platform = vi.hoisted(() => ({ os: 'ios' as 'ios' | 'android' }));

vi.mock('react-native', async (importOriginal) => {
    const { withSystemScheme } = await import('@commise/ui/testing/system-color-scheme');
    const actual = withSystemScheme(await importOriginal<typeof import('react-native')>());

    return {
        ...actual,
        Platform: {
            ...actual.Platform,
            get OS() {
                return platform.os;
            },
        },
        AccessibilityInfo: { ...actual.AccessibilityInfo, announceForAccessibilityWithOptions: vi.fn() },
    };
});

beforeEach(() => {
    platform.os = 'ios';
});

afterEach(() => {
    cleanup();
    vi.mocked(AccessibilityInfo.announceForAccessibilityWithOptions).mockClear();
});

const noop = () => undefined;
const base: RecipePhotoManagerProps = { photos: [], onRemovePhoto: noop };
const announced = (): string[] =>
    vi.mocked(AccessibilityInfo.announceForAccessibilityWithOptions).mock.calls.map(([message]) => message);

describe('RecipePhotoManager (native) — upload announcements (WCAG 4.1.3)', () => {
    it('announces nothing, and holds polite live regions, while idle', () => {
        const { container } = render(<RecipePhotoManager {...base} />);

        expect(announced()).toEqual([]);
        expect(container.querySelectorAll('[aria-live="polite"]').length).toBeGreaterThan(0);
    });

    it('iOS: announces "Uploading photo" once when an upload starts', () => {
        const { rerender } = render(<RecipePhotoManager {...base} />);

        rerender(<RecipePhotoManager {...base} uploading />);

        expect(announced()).toEqual(['Uploading photo']);
    });

    it('iOS: announces "Photo uploaded" when an upload finishes', () => {
        const { rerender } = render(<RecipePhotoManager {...base} uploading />);

        rerender(
            <RecipePhotoManager
                {...base}
                uploading={false}
                queueItems={[makeQueueItem({ fileId: 1, status: 'ok' })]}
            />,
        );

        expect(announced()).toEqual(['Uploading photo', 'Photo uploaded']);
    });

    it('iOS: announces a SECOND finished upload again', () => {
        const one = [makeQueueItem({ fileId: 1, status: 'ok' })];
        const two = [...one, makeQueueItem({ fileId: 2, status: 'ok' })];
        const { rerender } = render(<RecipePhotoManager {...base} />);

        rerender(<RecipePhotoManager {...base} queueItems={one} />);
        rerender(<RecipePhotoManager {...base} queueItems={two} />);

        expect(announced()).toEqual(['Photo uploaded', 'Photo uploaded']);
    });

    it('Android: the live-region text carries the message, with no imperative announcement', () => {
        platform.os = 'android';
        const { container, rerender } = render(<RecipePhotoManager {...base} />);

        rerender(<RecipePhotoManager {...base} uploading />);

        expect(announced()).toEqual([]);
        const texts = Array.from(container.querySelectorAll('[aria-live="polite"]')).map((node) => node.textContent);
        expect(texts).toContain('Uploading photo');
    });

    it('does NOT announce "Photo uploaded" when the upload failed — the assertive failure alert speaks', () => {
        const failed = [makeQueueItem({ fileId: 1, fileName: 'a.png', status: 'failed', retryable: true })];
        const { container, rerender } = render(<RecipePhotoManager {...base} uploading />);

        rerender(<RecipePhotoManager {...base} uploading={false} queueItems={failed} errorMessage="Upload failed." />);

        expect(announced()).not.toContain('Photo uploaded');
        // The failure keeps its own assertive alert; this suite only pins that the polite region adds nothing.
        expect(container.querySelector('[role="alert"]')?.textContent).toContain('Upload failed.');
    });
});
