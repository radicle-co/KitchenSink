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
        <section aria-label={m.heading}>
            <h3>{m.heading}</h3>

            {uploading === true ? <p role="status" aria-label={m.uploadingLabel} /> : null}
            {errorMessage !== undefined ? <p role="alert">{errorMessage}</p> : null}

            {photos.length === 0 ? (
                <p>{m.emptyBody}</p>
            ) : (
                <ul>
                    {photos.map((photo, index) => {
                        const removing = removingPhotoId === photo.id;

                        return (
                            <li key={photo.id}>
                                <img src={photo.url} alt={fillTemplate(m.photoAlt, { index: index + 1 })} />
                                <button
                                    type="button"
                                    aria-label={fillTemplate(m.removeLabel, { index: index + 1 })}
                                    aria-busy={removing}
                                    disabled={removing}
                                    onClick={() => onRemovePhoto(photo.id)}
                                >
                                    {removing ? m.removing : m.remove}
                                </button>
                            </li>
                        );
                    })}
                </ul>
            )}

            {atCap ? <p>{fillTemplate(m.maxReached, { max: MAX_RECIPE_PHOTOS })}</p> : addControl}
        </section>
    );
};
