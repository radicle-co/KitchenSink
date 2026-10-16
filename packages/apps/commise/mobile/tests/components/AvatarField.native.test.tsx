/**
 * Component tests for `AvatarField` (U2) — the profile screen's replacement for the old avatar-URL text box.
 * It mirrors `RecipePhotoUploader`: a DS `Button` opens `expo-image-picker`, the picked asset's bytes are
 * read as a Blob, client-validated against the 5 MB / JPEG-PNG-WebP allowlist (the same limits the identity
 * presign enforces), uploaded via `useAvatarUpload`, and the durable public URL is handed back through
 * `onChange` for the profile PATCH to persist.
 *
 * REWRITTEN for A-025: the field is the Profile header's ONE avatar — a 72 dp disc that is itself the change-photo
 * control, with the cook's initials as the no-photo fallback (so the header and the photo cannot disagree). It no longer
 * draws a "Profile photo" label or its own error line: a failed pick is REPORTED through `onError` and the page draws
 * the single alert. `expo-image-picker`, `useAvatarUpload`, and the global
 * `fetch` (the local blob read) are mocked; the on-device picker + real S3 PUT are a Maestro concern.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { avatarCopyOf, profileMessages } from '@commise/features-account/profile';
import { role, roleDark } from '@commise/ui/colors';
import { rgb, systemScheme } from '@commise/ui/testing/system-color-scheme';
import * as ImagePicker from 'expo-image-picker';

import { AvatarField } from '../../src/components/account/AvatarField.js';
import { useAvatarUpload } from '../../src/hooks/useAvatarUpload.js';
import { mobileMessages } from '../../src/i18n/messages.js';

vi.mock('react-native', async (importOriginal) => {
    const { withSystemScheme } = await import('@commise/ui/testing/system-color-scheme');

    return withSystemScheme(await importOriginal<typeof import('react-native')>());
});

vi.mock('expo-image-picker', () => ({
    MediaTypeOptions: { Images: 'Images' },
    launchImageLibraryAsync: vi.fn(),
}));

// Stub the network seam only; the client-side size/type validators live in the pure `avatarConstraints`
// module of `@commise/features-account/profile` (imported by AvatarField directly), so they run for real without pulling `@clerk/expo` in here.
vi.mock('../../src/hooks/useAvatarUpload.js', () => ({ useAvatarUpload: vi.fn() }));

const { profile } = mobileMessages.en;

const messages = avatarCopyOf(profileMessages.en);

const launchMock = vi.mocked(ImagePicker.launchImageLibraryAsync);
const useAvatarUploadMock = vi.mocked(useAvatarUpload);
const uploadMock = vi.fn();
const fetchMock = vi.fn();

const pickedAsset = { uri: 'file:///tmp/avatar.png', fileName: 'avatar.png', mimeType: 'image/png' };

beforeEach(() => {
    launchMock.mockReset();
    uploadMock.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    useAvatarUploadMock.mockReturnValue({ upload: uploadMock });
    launchMock.mockResolvedValue({ canceled: false, assets: [pickedAsset] } as never);
});

afterEach(() => {
    systemScheme.current = null;
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
});

describe('AvatarField', () => {
    it('is ONE 72 dp control named for what it does, with no label of its own', () => {
        render(
            <AvatarField
                value="https://cdn/existing.jpg"
                initials="EM"
                onChange={vi.fn()}
                onError={vi.fn()}
                messages={messages}
            />,
        );

        const control = screen.getByRole('button', { name: messages.changeAction });

        expect(window.getComputedStyle(control).width).toBe('72px');
        expect(window.getComputedStyle(control).height).toBe('72px');
        expect(screen.queryByText(profile.avatarLabel)).toBeNull();
    });

    it('shows the cook’s initials when there is no photo, and not when there is one', () => {
        const { rerender } = render(
            <AvatarField value="" initials="EM" onChange={vi.fn()} onError={vi.fn()} messages={messages} />,
        );

        expect(screen.getByText('EM')).toBeTruthy();

        rerender(
            <AvatarField
                value="https://cdn/existing.jpg"
                initials="EM"
                onChange={vi.fn()}
                onError={vi.fn()}
                messages={messages}
            />,
        );

        expect(screen.queryByText('EM')).toBeNull();
    });

    it('shows the user glyph, not an empty disc, with neither a photo nor initials', () => {
        render(<AvatarField value="" initials="" onChange={vi.fn()} onError={vi.fn()} messages={messages} />);

        const glyphs = (): (string | null)[] =>
            Array.from(
                screen.getByRole('button', { name: messages.changeAction }).querySelectorAll('[data-icon-name]'),
            ).map((node) => node.getAttribute('data-icon-name'));

        // The camera badge is always drawn; the user glyph fills an empty disc.
        expect(glyphs()).toEqual(['user', 'camera']);
        cleanup();

        render(<AvatarField value="" initials="EM" onChange={vi.fn()} onError={vi.fn()} messages={messages} />);

        expect(glyphs()).toEqual(['camera']);
    });

    it('picks an allowlisted image, uploads it, and reports the new URL through onChange', async () => {
        const onChange = vi.fn();
        fetchMock.mockResolvedValueOnce({ blob: async () => new Blob([new Uint8Array(1024)], { type: 'image/png' }) });
        uploadMock.mockResolvedValue('https://cdn/new-avatar.png');

        render(<AvatarField value="" initials="EM" onChange={onChange} onError={vi.fn()} messages={messages} />);
        fireEvent.click(screen.getByRole('button', { name: messages.changeAction }));

        await waitFor(() => expect(onChange).toHaveBeenCalledWith('https://cdn/new-avatar.png'));
        expect(uploadMock).toHaveBeenCalledWith(
            expect.objectContaining({ contentType: 'image/png', blob: expect.any(Blob) }),
        );
    });

    it('clears any earlier error as soon as a new pick starts', async () => {
        const onError = vi.fn();
        launchMock.mockResolvedValue({ canceled: true, assets: null } as never);

        render(<AvatarField value="" initials="EM" onChange={vi.fn()} onError={onError} messages={messages} />);
        fireEvent.click(screen.getByRole('button', { name: messages.changeAction }));

        await waitFor(() => expect(launchMock).toHaveBeenCalledTimes(1));
        expect(onError).toHaveBeenCalledWith(undefined);
    });

    it('rejects an oversized pick client-side — never uploads, reports the size error', async () => {
        const onChange = vi.fn();
        const onError = vi.fn();
        fetchMock.mockResolvedValueOnce({
            blob: async () => new Blob([new Uint8Array(5 * 1024 * 1024 + 1)], { type: 'image/png' }),
        });

        render(<AvatarField value="" initials="EM" onChange={onChange} onError={onError} messages={messages} />);
        fireEvent.click(screen.getByRole('button', { name: messages.changeAction }));

        await waitFor(() => expect(onError).toHaveBeenLastCalledWith(messages.tooLargeError));
        expect(uploadMock).not.toHaveBeenCalled();
        expect(onChange).not.toHaveBeenCalled();
    });

    it('rejects a disallowed MIME type client-side — never uploads, reports the type error', async () => {
        const onError = vi.fn();
        launchMock.mockResolvedValue({
            canceled: false,
            assets: [{ ...pickedAsset, mimeType: 'image/gif', fileName: 'clip.gif' }],
        } as never);
        fetchMock.mockResolvedValueOnce({ blob: async () => new Blob(['x'], { type: 'image/gif' }) });

        render(<AvatarField value="" initials="EM" onChange={vi.fn()} onError={onError} messages={messages} />);
        fireEvent.click(screen.getByRole('button', { name: messages.changeAction }));

        await waitFor(() => expect(onError).toHaveBeenLastCalledWith(messages.unsupportedTypeError));
        expect(uploadMock).not.toHaveBeenCalled();
    });

    it('does nothing when the pick is canceled', async () => {
        const onChange = vi.fn();
        const onError = vi.fn();
        launchMock.mockResolvedValue({ canceled: true, assets: null } as never);

        render(<AvatarField value="" initials="EM" onChange={onChange} onError={onError} messages={messages} />);
        fireEvent.click(screen.getByRole('button', { name: messages.changeAction }));

        await waitFor(() => expect(launchMock).toHaveBeenCalledTimes(1));
        expect(uploadMock).not.toHaveBeenCalled();
        expect(onChange).not.toHaveBeenCalled();
        expect(onError).not.toHaveBeenCalledWith(messages.uploadError);
    });

    it('reports the upload error when the upload fails', async () => {
        const onChange = vi.fn();
        const onError = vi.fn();
        fetchMock.mockResolvedValueOnce({ blob: async () => new Blob([new Uint8Array(1024)], { type: 'image/png' }) });
        uploadMock.mockRejectedValue(new Error('network'));

        render(<AvatarField value="" initials="EM" onChange={onChange} onError={onError} messages={messages} />);
        fireEvent.click(screen.getByRole('button', { name: messages.changeAction }));

        await waitFor(() => expect(onError).toHaveBeenLastCalledWith(messages.uploadError));
        expect(onChange).not.toHaveBeenCalled();
    });

    it('cannot start a second pick while one is in flight, and says it is busy', async () => {
        let release: (value: unknown) => void = () => undefined;
        launchMock.mockReturnValue(new Promise((resolve) => (release = resolve)) as never);

        render(<AvatarField value="" initials="EM" onChange={vi.fn()} onError={vi.fn()} messages={messages} />);
        const control = screen.getByRole('button', { name: messages.changeAction });
        fireEvent.click(control);
        await waitFor(() => expect(control.getAttribute('aria-busy')).toBe('true'));
        fireEvent.click(control);

        expect(launchMock).toHaveBeenCalledTimes(1);
        release({ canceled: true, assets: null });
        await waitFor(() => expect(control.getAttribute('aria-busy')).toBe('false'));
    });
});

describe.each([
    ['light', role],
    ['dark', roleDark],
] as const)('AvatarField — the %s theme reads colour from roles', (name, roles) => {
    beforeEach(() => {
        systemScheme.current = name;
    });

    it('paints the initials disc in action with onAction text', () => {
        render(<AvatarField value="" initials="EM" onChange={vi.fn()} onError={vi.fn()} messages={messages} />);

        expect(
            window.getComputedStyle(screen.getByRole('button', { name: messages.changeAction })).backgroundColor,
        ).toBe(rgb(roles.action));
        expect(window.getComputedStyle(screen.getByText('EM')).color).toBe(rgb(roles.onAction));
    });

    it('paints the empty disc in surfaceMuted', () => {
        render(<AvatarField value="" initials="" onChange={vi.fn()} onError={vi.fn()} messages={messages} />);

        expect(
            window.getComputedStyle(screen.getByRole('button', { name: messages.changeAction })).backgroundColor,
        ).toBe(rgb(roles.surfaceMuted));
    });
});
