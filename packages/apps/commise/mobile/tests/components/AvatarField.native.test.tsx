/**
 * Component tests for `AvatarField` (U2) — the profile screen's replacement for the old avatar-URL text box.
 * It mirrors `RecipePhotoUploader`: a DS `Button` opens `expo-image-picker`, the picked asset's bytes are
 * read as a Blob, client-validated against the 5 MB / JPEG-PNG-WebP allowlist (the same limits the identity
 * presign enforces), uploaded via `useAvatarUpload`, and the durable public URL is handed back through
 * `onChange` for the profile PATCH to persist. `expo-image-picker`, `useAvatarUpload`, and the global
 * `fetch` (the local blob read) are mocked; the on-device picker + real S3 PUT are a Maestro concern.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import * as ImagePicker from 'expo-image-picker';

import { AvatarField } from '../../src/components/account/AvatarField.js';
import { useAvatarUpload } from '../../src/hooks/useAvatarUpload.js';
import { mobileMessages } from '../../src/i18n/messages.js';

vi.mock('expo-image-picker', () => ({
    MediaTypeOptions: { Images: 'Images' },
    launchImageLibraryAsync: vi.fn(),
}));

// Stub the network seam only; the client-side size/type validators live in the pure `avatarConstraints`
// module (imported by AvatarField directly), so they run for real without pulling `@clerk/expo` in here.
vi.mock('../../src/hooks/useAvatarUpload.js', () => ({ useAvatarUpload: vi.fn() }));

const { profile } = mobileMessages.en;

const messages = {
    label: profile.avatarLabel,
    imageLabel: profile.avatarImageLabel,
    changeAction: profile.avatarChangeAction,
    uploadError: profile.avatarUploadError,
    tooLargeError: profile.avatarTooLargeError,
    unsupportedTypeError: profile.avatarUnsupportedTypeError,
};

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
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
});

describe('AvatarField', () => {
    it('renders the labelled preview and the change-photo control', () => {
        render(<AvatarField value="https://cdn/existing.jpg" onChange={vi.fn()} messages={messages} />);

        expect(screen.getByText(messages.label)).toBeTruthy();
        expect(screen.getByLabelText(messages.imageLabel)).toBeTruthy();
        expect(screen.getByRole('button', { name: messages.changeAction })).toBeTruthy();
    });

    it('picks an allowlisted image, uploads it, and reports the new URL through onChange', async () => {
        const onChange = vi.fn();
        fetchMock.mockResolvedValueOnce({ blob: async () => new Blob([new Uint8Array(1024)], { type: 'image/png' }) });
        uploadMock.mockResolvedValue('https://cdn/new-avatar.png');

        render(<AvatarField value="" onChange={onChange} messages={messages} />);
        fireEvent.click(screen.getByRole('button', { name: messages.changeAction }));

        await waitFor(() => expect(onChange).toHaveBeenCalledWith('https://cdn/new-avatar.png'));
        expect(uploadMock).toHaveBeenCalledWith(
            expect.objectContaining({ contentType: 'image/png', blob: expect.any(Blob) }),
        );
    });

    it('rejects an oversized pick client-side — never uploads, shows the size error', async () => {
        const onChange = vi.fn();
        fetchMock.mockResolvedValueOnce({
            blob: async () => new Blob([new Uint8Array(5 * 1024 * 1024 + 1)], { type: 'image/png' }),
        });

        render(<AvatarField value="" onChange={onChange} messages={messages} />);
        fireEvent.click(screen.getByRole('button', { name: messages.changeAction }));

        expect(await screen.findByText(messages.tooLargeError)).toBeTruthy();
        expect(uploadMock).not.toHaveBeenCalled();
        expect(onChange).not.toHaveBeenCalled();
    });

    it('rejects a disallowed MIME type client-side — never uploads, shows the type error', async () => {
        const onChange = vi.fn();
        launchMock.mockResolvedValue({
            canceled: false,
            assets: [{ ...pickedAsset, mimeType: 'image/gif', fileName: 'clip.gif' }],
        } as never);
        fetchMock.mockResolvedValueOnce({ blob: async () => new Blob(['x'], { type: 'image/gif' }) });

        render(<AvatarField value="" onChange={onChange} messages={messages} />);
        fireEvent.click(screen.getByRole('button', { name: messages.changeAction }));

        expect(await screen.findByText(messages.unsupportedTypeError)).toBeTruthy();
        expect(uploadMock).not.toHaveBeenCalled();
    });

    it('does nothing when the pick is canceled', async () => {
        const onChange = vi.fn();
        launchMock.mockResolvedValue({ canceled: true, assets: null } as never);

        render(<AvatarField value="" onChange={onChange} messages={messages} />);
        fireEvent.click(screen.getByRole('button', { name: messages.changeAction }));

        await waitFor(() => expect(launchMock).toHaveBeenCalledTimes(1));
        expect(uploadMock).not.toHaveBeenCalled();
        expect(onChange).not.toHaveBeenCalled();
        expect(screen.queryByText(messages.uploadError)).toBeNull();
    });

    it('surfaces the upload error when the upload fails', async () => {
        const onChange = vi.fn();
        fetchMock.mockResolvedValueOnce({ blob: async () => new Blob([new Uint8Array(1024)], { type: 'image/png' }) });
        uploadMock.mockRejectedValue(new Error('network'));

        render(<AvatarField value="" onChange={onChange} messages={messages} />);
        fireEvent.click(screen.getByRole('button', { name: messages.changeAction }));

        expect(await screen.findByText(messages.uploadError)).toBeTruthy();
        expect(onChange).not.toHaveBeenCalled();
    });
});
