/**
 * @module components/account/AvatarField — the profile screen's avatar control (U2).
 *
 * Replaces the old "paste an image URL" text box with a real device flow, modelled on
 * {@link import('../RecipePhotoUploader.js').RecipePhotoUploader}: a design-system {@link Button} opens
 * `expo-image-picker`, the picked asset's bytes are read as a Blob, client-validated against the same
 * 5 MB / JPEG-PNG-WebP allowlist the identity presign enforces (so an obviously-invalid pick fails fast,
 * before any request), uploaded via {@link useAvatarUpload}, and the durable public URL is handed back
 * through `onChange` for the profile PATCH to persist. Presentational otherwise: it owns only the in-flight
 * + error state of a pick, never the profile form's `value`.
 *
 * `expo-image-picker` is imported lazily on first use (it pulls `expo-modules-core`, which only evaluates in
 * the native runtime) — mirroring the recipe uploader.
 */
import { Button } from '@commise/ui/button';
import { palette, semantic } from '@commise/ui';
import { nativeTokens } from '@commise/ui/native';
import { Feather } from '@expo/vector-icons';
import { Image } from 'expo-image';
import type { FC } from 'react';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useAvatarUpload } from '../../hooks/useAvatarUpload.js';
import { AVATAR_MAX_BYTES, isAllowedAvatarType } from './avatarConstraints.js';

/** Localized copy the field renders (supplied by the profile screen from `mobileMessages.profile`). */
export interface AvatarFieldMessages {
    /** Section label above the picker. */
    readonly label: string;
    /** Accessible name of the avatar preview. */
    readonly imageLabel: string;
    /** Label of the control that opens the picker. */
    readonly changeAction: string;
    /** Shown when picking or uploading fails. */
    readonly uploadError: string;
    /** Shown when the picked image exceeds {@link AVATAR_MAX_BYTES}. */
    readonly tooLargeError: string;
    /** Shown when the picked image's type is outside the allowlist. */
    readonly unsupportedTypeError: string;
}

/** Props for {@link AvatarField}. */
export interface AvatarFieldProps {
    /** The current avatar URL (empty string when the viewer has no avatar yet). */
    readonly value: string;
    /** Reports a freshly uploaded avatar's durable public URL for the form to persist. */
    readonly onChange: (url: string) => void;
    /** Localized copy. */
    readonly messages: AvatarFieldMessages;
}

/** The avatar picker + preview for the profile edit form. */
export const AvatarField: FC<AvatarFieldProps> = ({ value, onChange, messages }) => {
    const { upload } = useAvatarUpload();
    // `busy` spans the full pick → blob-read → upload window, so a second tap can't launch a second picker
    // or a second upload (the recipe uploader's B24 re-entrancy guard, applied to the single-asset case).
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | undefined>(undefined);

    const pickAndUpload = async (): Promise<void> => {
        if (busy) {
            return;
        }

        setBusy(true);
        setError(undefined);

        try {
            // Lazily load the native picker (see the module doc): keeps `expo-modules-core` out of the graph
            // until the user actually taps Change.
            const ImagePicker = await import('expo-image-picker');
            const result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ImagePicker.MediaTypeOptions.Images,
                quality: 0.8,
            });

            if (result.canceled) {
                return;
            }

            const asset = result.assets[0];

            if (asset === undefined) {
                return;
            }

            const contentType = asset.mimeType ?? 'image/jpeg';

            if (!isAllowedAvatarType(contentType)) {
                setError(messages.unsupportedTypeError);

                return;
            }

            let blob: Blob;

            try {
                blob = await (await fetch(asset.uri)).blob();
            } catch {
                setError(messages.uploadError);

                return;
            }

            // Validate against the BLOB's real size — `asset.fileSize` is often absent on Android/web, so
            // trusting it would let an oversized file slip past this pre-check (the recipe uploader's lesson).
            if (blob.size > AVATAR_MAX_BYTES) {
                setError(messages.tooLargeError);

                return;
            }

            try {
                const url = await upload({ blob, contentType });
                onChange(url);
            } catch {
                setError(messages.uploadError);
            }
        } finally {
            setBusy(false);
        }
    };

    return (
        <View style={styles.field}>
            <Text style={styles.label}>{messages.label}</Text>
            <View style={styles.row}>
                {value ? (
                    <Image
                        source={{ uri: value }}
                        style={styles.avatar}
                        contentFit="cover"
                        accessibilityLabel={messages.imageLabel}
                    />
                ) : (
                    <View style={styles.placeholder} accessibilityRole="image" accessibilityLabel={messages.imageLabel}>
                        <Feather name="user" size={28} color={palette.slate} />
                    </View>
                )}
                <Button
                    variant="secondary"
                    icon={<Feather name="camera" size={16} color={palette.charcoal} />}
                    busy={busy}
                    onPress={() => void pickAndUpload()}
                >
                    {messages.changeAction}
                </Button>
            </View>
            {error ? (
                <Text role="alert" style={styles.error}>
                    {error}
                </Text>
            ) : null}
        </View>
    );
};

const AVATAR_SIZE = 64;

const styles = StyleSheet.create({
    field: { gap: nativeTokens.spacing[2] },
    label: {
        fontSize: nativeTokens.fontSize.bodySm,
        fontWeight: '600',
        color: palette.charcoal,
    },
    row: { flexDirection: 'row', alignItems: 'center', gap: nativeTokens.spacing[3] },
    avatar: { width: AVATAR_SIZE, height: AVATAR_SIZE, borderRadius: AVATAR_SIZE / 2 },
    placeholder: {
        width: AVATAR_SIZE,
        height: AVATAR_SIZE,
        borderRadius: AVATAR_SIZE / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: palette.pearl,
        borderWidth: 1,
        borderColor: semantic.border,
    },
    error: {
        fontSize: nativeTokens.fontSize.caption,
        color: palette.error,
    },
});
