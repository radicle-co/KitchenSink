/**
 * @module @commise/features-recipes/photos/photoMenu — what a photo tile's ⋯ menu holds (owner ruling 2026-10-17,
 * buildSpec §7.7): Set as cover, Move earlier, Move later, Replace, then Remove after a divider.
 *
 * ONE statement of the menu's contents and of when each item applies, read by the web and the native leaf so the two
 * cannot drift. The items are the design system's `ActionMenuItem`s; the menu itself is `@commise/ui/action-menu`.
 *
 * @pattern Specification — the rules for when an item applies, kept out of the render leaves
 */
import type { ActionMenuItem } from '@commise/ui/action-menu';

import type { PhotoMessages } from './messages.js';
import type { PhotoMoveDirection } from './model.js';

/** What the menu needs to know about its tile and about what the container wired. */
export interface PhotoMenuInput {
    readonly copy: PhotoMessages;
    readonly photoId: string;
    /** The tile's zero-based position. */
    readonly index: number;
    /** How many confirmed photos the recipe holds. */
    readonly count: number;
    /** A reorder is in flight, so Set as cover and both moves wait for it. */
    readonly reordering: boolean;
    readonly onRemovePhoto: (photoId: string) => void;
    readonly onSetCover?: (photoId: string) => void;
    readonly onMovePhoto?: (photoId: string, direction: PhotoMoveDirection) => void;
    readonly onReplacePhoto?: (photoId: string) => void;
}

/** A photo tile's menu: the actions in the ruled order and the one destructive action. */
export interface PhotoMenu {
    readonly items: readonly ActionMenuItem[];
    readonly destructiveItem: ActionMenuItem;
}

/**
 * The menu for a confirmed photo's tile. An action the container did not wire is absent, not disabled: a disabled item
 * means "not now", and an unwired one is "not here". Pure.
 *
 * @param input - The tile, the photo count and the wired handlers.
 * @returns The ordered items and the destructive Remove.
 */
export function photoMenu({
    copy,
    photoId,
    index,
    count,
    reordering,
    onRemovePhoto,
    onSetCover,
    onMovePhoto,
    onReplacePhoto,
}: PhotoMenuInput): PhotoMenu {
    const items: ActionMenuItem[] = [];

    if (onSetCover !== undefined) {
        // The cover is index 0 (`isCoverPhoto`): setting it again is a no-op the menu says is unavailable.
        items.push({
            id: 'setCover',
            label: copy.setCover,
            disabled: reordering || index === 0,
            onSelect: () => onSetCover(photoId),
        });
    }

    if (onMovePhoto !== undefined) {
        items.push(
            {
                id: 'moveEarlier',
                label: copy.moveEarlier,
                disabled: reordering || index === 0,
                onSelect: () => onMovePhoto(photoId, 'earlier'),
            },
            {
                id: 'moveLater',
                label: copy.moveLater,
                disabled: reordering || index === count - 1,
                onSelect: () => onMovePhoto(photoId, 'later'),
            },
        );
    }

    if (onReplacePhoto !== undefined) {
        items.push({ id: 'replace', label: copy.replace, onSelect: () => onReplacePhoto(photoId) });
    }

    return { items, destructiveItem: { id: 'remove', label: copy.remove, onSelect: () => onRemovePhoto(photoId) } };
}
