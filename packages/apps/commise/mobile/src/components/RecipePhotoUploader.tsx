/**
 * Recipe photo uploader (mobile, T067, wireframe step 4; w3/e4 per-file queue grid). The container that turns
 * the shared, presentational {@link RecipePhotoManager} block (its native leaf) into a working photo surface:
 * it reads the recipe's photos from the query cache, supplies the native image-picker button as the block's
 * `addControl`, and ENQUEUES every picked asset onto `useRecipePhotoUploadQueue` (w3/e4) — the layer that
 * drives the shared, single-flight `useRecipePhotoUpload` headless hook (CP-6/P3, B24) once per file,
 * sequentially, while the grid shows each file's own status.
 *
 * **Add photos (A-010).** The add control is a secondary `Button` that opens a sheet of two sources, "Take photo" and
 * "Choose from library". The chosen source is HELD until the sheet has gone and the picker is launched at its
 * `onDismissed` — iOS shows one modal at a time, so a picker opened under a sliding sheet never appears (the rule
 * `ActionMenu` keeps for its chosen item). The camera asks for its permission first and says so, in words, when it is
 * refused or the device has none; the library asks for nothing. Replace stays on the library.
 *
 * Upload flow, on a picked asset: read the asset's bytes as a Blob, then enqueue `{ blob, fileName,
 * contentType, fileSize, previewUri: asset.uri }` (the asset's own URI doubles as the grid thumbnail while
 * queued/uploading/failed — no extra copy needed on this platform, unlike the web leaf's `createObjectURL`).
 * `fileSize` is read from the Blob (`blob.size`), NOT `asset.fileSize` — see `addPhoto`'s comment for why
 * the picker's own metadata is not a trustworthy source for the REQ-011 size check.
 * The queue drives the presign → S3 PUT → confirm sequence per file; `confirm → invalidateRecipeProjections`
 * still runs exactly once per successful upload, from inside `useRecipePhotoUpload`. Removal of a CONFIRMED
 * photo delegates to `useDeleteRecipePhoto`, busying just the row whose deletion is in flight; the queue's own
 * `retry`/`remove` handle a queued/failed FILE. Cross-platform peer of the web container; the picker
 * (`expo-image-picker`) and the real S3 upload require on-device verification.
 *
 * **Pick + blob-read re-entrancy (B24-adjacent, closed for the full window).** The queue's `uploading` only
 * reflects an upload that has actually STARTED, but the picker launch + local blob read that happen BEFORE
 * `enqueue()` are themselves awaited work with no guard of their own. `picking` covers that window: the add
 * control is disabled only while `picking` (never while an upload is in flight — the whole point of the
 * queue is that a second pick during an in-flight upload is accepted and queued, not blocked), and `addPhoto`
 * early-returns if a pick is already underway — so a second tap during the picker/blob-read can't launch
 * `expo-image-picker` a second time concurrently.
 *
 * Every enqueued asset also passes through the queue's client-side pre-validation (REQ-011 size, REQ-012
 * MIME allowlist) — this container's only involvement is supplying the two localized rejection strings;
 * the admission check itself lives in `useRecipePhotoUploadQueue`.
 */
import { RecipePhotoManager, photoMessages } from '@commise/features-recipes';
import type { PhotoUploaderTarget } from '@commise/features-recipes/editor';
import type { RecipePhotoPickIntent, RecipePhotoQueueFile } from '@commise/features-recipes/hooks';
import { useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { Icon, type IconName } from '@commise/ui/icon';
import { nativeTokens } from '@commise/ui/native';
import { Sheet } from '@commise/ui/sheet';
import { useTheme } from '@commise/ui/theme';
import type { JSX } from 'react';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { usePressFill } from '@commise/ui/surface-tone';

/** Props for {@link RecipePhotoUploader}: the editor's photo target (`RecipeEditorSurface`). */
export type RecipePhotoUploaderProps = PhotoUploaderTarget;

/** Where a photo comes from — the two choices the Add photos sheet offers. */
type PhotoSource = 'camera' | 'library';

/** One row of the Add photos sheet: a glyph and a label, at the sheet-row height (buildSpec §7.10: 56). */
function SourceRow({
    icon,
    label,
    onChoose,
}: {
    readonly icon: IconName;
    readonly label: string;
    readonly onChoose: () => void;
}): JSX.Element {
    const { colors } = useTheme();
    const wash = usePressFill();

    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={label}
            onPress={onChoose}
            style={({ pressed }) => [styles.sourceRow, pressed && { backgroundColor: wash }]}
        >
            <Icon name={icon} size={24} />
            <Text style={[styles.sourceLabel, { color: colors.ink }]}>{label}</Text>
        </Pressable>
    );
}

/**
 * The recipe photo uploader.
 *
 * @param props - The id of the recipe whose photos are managed.
 * @returns The photo manager block wired to the native picker and the upload-queue/remove mutations.
 */
export function RecipePhotoUploader({
    recipeId,
    title,
    cuisine,
    manager: session,
}: RecipePhotoUploaderProps): JSX.Element {
    const photoCopy = useMessages(photoMessages);
    // The session (photos, queue, delete, cover, the one error slot, the cap rule and every refusal sentence) is the
    // editor's one session, shared with web. On a recipe with no id yet a pick waits in its queue (U33).
    const { queue } = session;

    // Tracks the picker-launch + local-blob-read window, BEFORE `enqueue()` ever runs — see the re-entrancy
    // guard in the module doc above.
    const [picking, setPicking] = useState(false);
    // The Add photos sheet (A-010): open or not, the source the cook chose, and a request to give the button
    // back its focus when the sheet closes with nothing chosen.
    const [sheetOpen, setSheetOpen] = useState(false);
    const [chosenSource, setChosenSource] = useState<PhotoSource | undefined>(undefined);
    const [buttonFocusRequested, setButtonFocusRequested] = useState(false);

    // Pick an image (from `source`), then enqueue it onto the upload queue — the queue drives the presign → PUT-to-S3 →
    // confirm sequence itself. A canceled pick is a silent no-op. `picking` spans ONLY the picker-launch +
    // blob-read window (never the upload itself), so a second tap while a PREVIOUS pick is still resolving
    // can't launch `expo-image-picker` a second time concurrently — but a tap while a PREVIOUS upload is
    // still in flight is welcomed: it enqueues, exactly the queue's reason to exist.
    // `intent` says what the pick is FOR ('add' or 'replace'), stated by the caller; it is not inferred from `onUploaded`.
    // `onUploaded` is the optional post-commit continuation carried on the enqueued file (see
    // `useRecipePhotoUploadQueue`): the queue runs it once, only after this file's confirm has landed. Add
    // passes none; Replace passes the "now delete the photo you replaced" step.
    //
    // ⛔ The CALLER sets `picking` before calling: the sheet's choice sets it at the press, so the button already
    // reads busy while the sheet slides away (the picker opens only after that, see `onSheetDismissed`), and a tap
    // in that gap does nothing. This function resets it, whatever happens.
    const runPick = async (
        source: PhotoSource,
        intent: RecipePhotoPickIntent,
        onUploaded?: () => void,
    ): Promise<void> => {
        session.reportError(undefined);

        try {
            // Load the native picker lazily (on first use). `expo-image-picker` pulls in `expo-modules-core`,
            // which can only be evaluated inside the native runtime — deferring the import keeps it out of
            // the module graph until the user actually taps Add, and out of environments lacking that runtime.
            const ImagePicker = await import('expo-image-picker');
            const options = { mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8 };
            let result: Awaited<ReturnType<typeof ImagePicker.launchImageLibraryAsync>>;

            if (source === 'camera') {
                // The camera needs the cook's say-so; the library does not (the system picker hands over only what
                // they choose). A refusal is said out loud, with the way out — never a silent no-op.
                try {
                    const permission = await ImagePicker.requestCameraPermissionsAsync();

                    if (!permission.granted) {
                        session.reportError(photoCopy.cameraDenied);

                        return;
                    }

                    result = await ImagePicker.launchCameraAsync(options);
                } catch {
                    // A device with no camera (a simulator) rejects here rather than answering `canceled`.
                    session.reportError(photoCopy.cameraUnavailable);

                    return;
                }
            } else if (intent === 'add') {
                // Several at once, as the web file input allows: bounded by the room left (the queue's own count, so
                // the picker and the admission agree) and in the order picked, so the first becomes the cover.
                // `selectionLimit` is not honoured everywhere (iOS before 14), so the queue's refusal stays the backstop.
                result = await ImagePicker.launchImageLibraryAsync({
                    ...options,
                    allowsMultipleSelection: true,
                    selectionLimit: queue.remaining,
                    orderedSelection: true,
                });
            } else {
                // Replace swaps one photo for one.
                result = await ImagePicker.launchImageLibraryAsync(options);
            }

            if (result.canceled || result.assets.length === 0) {
                return;
            }

            let picked: RecipePhotoQueueFile[];

            try {
                picked = await Promise.all(
                    result.assets.map(async (asset) => {
                        const blob = await (await fetch(asset.uri)).blob();

                        // Authoritative size: `expo-image-picker`'s `asset.fileSize` is often null/undefined on
                        // Android/web, and a `?? 0` default there would silently admit an oversized file past the
                        // REQ-011 client pre-check (`0 > MAX` is always false). `blob.size` is the exact byte length of
                        // what's actually about to be uploaded, and it is also the presign request's `fileSize`, so
                        // that request describes the SAME bytes the S3 PUT sends.
                        return {
                            blob,
                            fileName: asset.fileName ?? 'photo.jpg',
                            contentType: asset.mimeType ?? 'image/jpeg',
                            fileSize: blob.size,
                            previewUri: asset.uri,
                            ...(onUploaded === undefined ? {} : { onUploaded }),
                        };
                    }),
                );
            } catch {
                // One unreadable asset sends none of the pick: the cook chose them together and is told once.
                session.reportError(photoCopy.uploadError);

                return;
            }

            // A pick past the room is refused whole, and the session says how many fit; on a recipe with no id yet the
            // queue holds what it took until the recipe exists (U33).
            session.enqueuePicked(picked, intent);
        } finally {
            setPicking(false);
        }
    };

    // U6 "Replace" — UPLOAD-FIRST, then swap (cancel-safe; mirrors the web container). No atomic replace
    // primitive exists server-side, and the previous ordering deleted the photo FIRST and only then opened the
    // picker: cancelling the picker (the single most likely outcome of an accidental tap) destroyed the
    // original, and so did any subsequent upload failure. The destructive half now runs LAST, as the
    // replacement's post-commit continuation — pick → blob-read → enqueue → presign → PUT → confirm → delete
    // the original. Every earlier exit (cancel, unreadable asset, validation rejection, failed PUT/confirm)
    // leaves the original photo exactly where it was.
    //
    // Cover semantics are deliberately unchanged: the replacement appends to the end, the delete promotes the
    // next photo when the cover was the one replaced, and no reorder is issued — the same final ordering the
    // old remove-then-add produced.
    //
    // At the cap there is nowhere for the replacement to land (the server enforces MAX_PHOTOS_EXCEEDED inside
    // the confirm transaction), so rather than delete first (data loss) or surface a misleading "upload
    // failed", Replace refuses with actionable copy and the user frees a slot deliberately.
    const replacePhoto = (photoId: string): void => {
        if (!session.beginReplace()) {
            return;
        }

        // Already mid-flight (a picker open, or a blob being read) — a second press is a no-op.
        if (picking) {
            return;
        }

        setPicking(true);
        // Replace stays on the library: it swaps one photo for another that already exists, and the sheet's
        // choice is for adding.
        void runPick('library', 'replace', () => session.removePhoto(photoId));
    };

    // The sheet's choice. It is HELD until the sheet has gone and runs at `onSheetDismissed`: iOS shows one modal at
    // a time, so a picker launched while the sheet is still on screen (or sliding out) never opens — the same rule
    // `ActionMenu` keeps for a chosen item. `picking` is set at the press so the button reads busy through the gap.
    const chooseSource = (source: PhotoSource): void => {
        if (picking || chosenSource !== undefined) {
            return;
        }

        setPicking(true);
        setChosenSource(source);
        setSheetOpen(false);
    };

    const onSheetDismissed = (): void => {
        if (chosenSource === undefined) {
            // Closed with nothing chosen: nothing was launched, and the cursor goes back to the button.
            setButtonFocusRequested(true);

            return;
        }

        const source = chosenSource;
        setChosenSource(undefined);
        void runPick(source, 'add');
    };

    // A-010: a real secondary button that opens the sheet of sources. `busy` is the pick window's only affordance — the
    // label never changes and the picker is a system screen — so it must reach assistive tech as busy (and, via the
    // Button, disabled), not leave a screen-reader user with "Add photos" and nothing else. The Sheet is rendered
    // below, outside the manager, so a photo cap reached mid-dismissal cannot unmount it before the held choice runs.
    const addControl = (
        <Button
            variant="secondary"
            icon="imagePlus"
            busy={picking}
            onPress={() => setSheetOpen(true)}
            focusRequested={buttonFocusRequested}
            onFocusRequestHandled={() => setButtonFocusRequested(false)}
        >
            {photoCopy.addPhotos}
        </Button>
    );

    return (
        <>
            <RecipePhotoManager
                photos={session.photos}
                onRemovePhoto={session.removePhoto}
                removingPhotoId={session.removingPhotoId}
                uploading={session.uploading}
                errorMessage={session.errorMessage}
                queueItems={queue.items}
                onRetryQueueItem={queue.retry}
                onRemoveQueueItem={queue.remove}
                onSetCover={session.setCover}
                onMovePhoto={session.movePhoto}
                reordering={session.reordering}
                onReplacePhoto={replacePhoto}
                addControl={addControl}
                coverPreview={{ recipeId: recipeId ?? '', title, cuisine }}
            />
            <Sheet
                open={sheetOpen}
                onOpenChange={setSheetOpen}
                onDismissed={onSheetDismissed}
                title={photoCopy.addPhotosSheetTitle}
                closeLabel={photoCopy.addPhotosSheetClose}
                size="content"
            >
                <View collapsable={false}>
                    <SourceRow icon="camera" label={photoCopy.takePhoto} onChoose={() => chooseSource('camera')} />
                    <SourceRow
                        icon="image"
                        label={photoCopy.chooseFromLibrary}
                        onChoose={() => chooseSource('library')}
                    />
                </View>
            </Sheet>
        </>
    );
}

const styles = StyleSheet.create({
    sourceRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: nativeTokens.spacing[2],
        minHeight: 56,
        paddingHorizontal: nativeTokens.spacing[2],
    },
    sourceLabel: nativeTokens.type.body,
});
