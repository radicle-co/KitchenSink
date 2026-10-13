/**
 * @module components/account/AvatarField — the Profile header's avatar and its photo control (U2, A-025).
 *
 * ONE 72 dp disc that is itself the change-photo control (`buildSpec.md` §9.1: "a 72 px avatar — initials, or the
 * native `AvatarField` photo"). It shows the saved photo, or the cook's initials when there is none, so the header and
 * the photo cannot disagree; a camera badge says it can be pressed. Pressing it opens `expo-image-picker`, the picked
 * asset's bytes are read as a Blob, client-validated against the same 5 MB / JPEG-PNG-WebP allowlist the identity
 * presign enforces (so an obviously-invalid pick fails fast, before any request), uploaded via {@link useAvatarUpload},
 * and the durable public URL is handed back through `onChange` for the profile PATCH to persist.
 *
 * Presentational otherwise: it owns only the in-flight state of a pick, never the saved `value`, and draws no error of its own: a failed pick is
 * REPORTED through `onError` so the page shows one alert for the photo, whether the pick or the save failed. Colour
 * comes from the theme at render.
 *
 * `expo-image-picker` is imported lazily on first use (it pulls `expo-modules-core`, which only evaluates in
 * the native runtime) — mirroring the recipe uploader.
 */
import { nativeTokens } from '@commise/ui/native';
import { Icon } from '@commise/ui/icon';
import { useTheme } from '@commise/ui/theme';
import { Image } from 'expo-image';
import type { FC } from 'react';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useAvatarUpload } from '../../hooks/useAvatarUpload.js';
import { AVATAR_MAX_BYTES, isAllowedAvatarType } from './avatarConstraints.js';

/** Localized copy the field renders (supplied by the profile screen from `mobileMessages.profile`). */
export interface AvatarFieldMessages {
    /** The control's accessible name: what pressing the avatar does. */
    readonly changeAction: string;
    /** Reported when picking or uploading fails. */
    readonly uploadError: string;
    /** Reported when the picked image exceeds {@link AVATAR_MAX_BYTES}. */
    readonly tooLargeError: string;
    /** Reported when the picked image's type is outside the allowlist. */
    readonly unsupportedTypeError: string;
}

/** Props for {@link AvatarField}. */
export interface AvatarFieldProps {
    /** The current avatar URL (empty string when the viewer has no avatar yet). */
    readonly value: string;
    /** The cook's initials, shown when there is no photo. Empty when the cook has no name. */
    readonly initials: string;
    /** Reports a freshly uploaded avatar's durable public URL for the form to persist. */
    readonly onChange: (url: string) => void;
    /** Reports why a pick failed, or `undefined` when a new pick starts and the earlier failure no longer applies. */
    readonly onError: (message: string | undefined) => void;
    /** Localized copy. */
    readonly messages: AvatarFieldMessages;
}

/** The avatar and its change-photo control. */
export const AvatarField: FC<AvatarFieldProps> = ({ value, initials, onChange, onError, messages }) => {
    const { colors } = useTheme();
    const { upload } = useAvatarUpload();
    // `busy` spans the full pick → blob-read → upload window, so a second tap can't launch a second picker
    // or a second upload (the recipe uploader's B24 re-entrancy guard, applied to the single-asset case).
    const [busy, setBusy] = useState(false);

    const pickAndUpload = async (): Promise<void> => {
        if (busy) {
            return;
        }

        setBusy(true);
        onError(undefined);

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
                onError(messages.unsupportedTypeError);

                return;
            }

            let blob: Blob;

            try {
                blob = await (await fetch(asset.uri)).blob();
            } catch {
                onError(messages.uploadError);

                return;
            }

            // Validate against the BLOB's real size — `asset.fileSize` is often absent on Android/web, so
            // trusting it would let an oversized file slip past this pre-check (the recipe uploader's lesson).
            if (blob.size > AVATAR_MAX_BYTES) {
                onError(messages.tooLargeError);

                return;
            }

            try {
                const url = await upload({ blob, contentType });
                onChange(url);
            } catch {
                onError(messages.uploadError);
            }
        } finally {
            setBusy(false);
        }
    };

    return (
        <Pressable
            role="button"
            aria-label={messages.changeAction}
            aria-busy={busy}
            accessibilityState={{ busy }}
            disabled={busy}
            onPress={() => void pickAndUpload()}
            style={[
                styles.disc,
                { backgroundColor: initials === '' ? colors.surfaceMuted : colors.action },
                busy ? styles.busy : null,
            ]}
        >
            {value === '' ? (
                initials === '' ? (
                    <Icon name="user" size={24} tone="inkMuted" />
                ) : (
                    <Text style={[styles.initials, { color: colors.onAction }]}>{initials}</Text>
                )
            ) : (
                <Image source={{ uri: value }} style={styles.photo} contentFit="cover" accessible={false} />
            )}
            <View
                aria-hidden
                style={[styles.badge, { backgroundColor: colors.paper, borderColor: colors.lineControl }]}
            >
                <Icon name="camera" size={16} tone="ink" />
            </View>
        </Pressable>
    );
};

/** The header's avatar size: the same 72 dp disc `ProfileHeader` draws. */
const AVATAR_SIZE = 72;
const BADGE_SIZE = 24;

const styles = StyleSheet.create({
    disc: {
        width: AVATAR_SIZE,
        height: AVATAR_SIZE,
        borderRadius: AVATAR_SIZE / 2,
        alignItems: 'center',
        justifyContent: 'center',
    },
    busy: { opacity: 0.6 },
    photo: { width: AVATAR_SIZE, height: AVATAR_SIZE, borderRadius: AVATAR_SIZE / 2 },
    initials: { ...nativeTokens.type.figureStat },
    badge: {
        position: 'absolute',
        right: 0,
        bottom: 0,
        width: BADGE_SIZE,
        height: BADGE_SIZE,
        borderRadius: BADGE_SIZE / 2,
        borderWidth: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
});
