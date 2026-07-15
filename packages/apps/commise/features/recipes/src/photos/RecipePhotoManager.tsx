/**
 * @module @commise/features-recipes — web recipe photo manager (T067 building block, wireframe step 4).
 *
 * Presentational: renders the recipe's photos with a per-photo remove control and busy/error affordances,
 * and renders the caller-supplied `addControl` (the web file input) below the grid — hidden once the recipe
 * is at the photo cap. The container owns image acquisition + the presign → PUT → confirm upload.
 */
import { useMessages } from '@commise/i18n/react';
import type { FC } from 'react';

import { fillTemplate } from '../list/model.js';
import { photoMessages } from './messages.js';
import { isAtPhotoCap, MAX_RECIPE_PHOTOS, type RecipePhotoManagerProps } from './model.js';

export const RecipePhotoManager: FC<RecipePhotoManagerProps> = ({
    photos,
    onRemovePhoto,
    removingPhotoId,
    uploading,
    errorMessage,
    addControl,
}) => {
    const m = useMessages(photoMessages);
    const atCap = isAtPhotoCap(photos.length);

    return (
        <section aria-label={m.heading} className="flex flex-col gap-3">
            <h3 className="font-display text-heading-md font-semibold text-charcoal">{m.heading}</h3>

            {uploading === true ? (
                <p role="status" aria-label={m.uploadingLabel} className="text-body-sm text-slate" />
            ) : null}
            {errorMessage !== undefined ? (
                <p role="alert" className="text-body-sm text-error">
                    {errorMessage}
                </p>
            ) : null}

            {photos.length === 0 ? (
                <p className="text-body-sm text-slate">{m.emptyBody}</p>
            ) : (
                <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {photos.map((photo, index) => {
                        const removing = removingPhotoId === photo.id;

                        return (
                            <li key={photo.id} className="relative overflow-hidden rounded-xl ring-1 ring-border">
                                <img
                                    src={photo.url}
                                    alt={fillTemplate(m.photoAlt, { index: index + 1 })}
                                    className="aspect-square w-full object-cover"
                                />
                                <button
                                    type="button"
                                    aria-label={fillTemplate(m.removeLabel, { index: index + 1 })}
                                    aria-busy={removing}
                                    disabled={removing}
                                    onClick={() => onRemovePhoto(photo.id)}
                                    className="absolute right-2 top-2 rounded-full bg-charcoal/70 px-3 py-1 text-caption font-medium text-white transition hover:bg-error disabled:opacity-60"
                                >
                                    {removing ? m.removing : m.remove}
                                </button>
                            </li>
                        );
                    })}
                </ul>
            )}

            {atCap ? (
                <p className="text-body-sm text-slate">{fillTemplate(m.maxReached, { max: MAX_RECIPE_PHOTOS })}</p>
            ) : (
                addControl
            )}
        </section>
    );
};
