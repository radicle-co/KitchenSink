'use client';

/**
 * @module @commise/features-recipes — web recipe-photo carousel + lightbox (W2 Task 2.2, D2).
 *
 * Replaces the static photo grid with a swipeable, scroll-snap strip of slides, a dot-navigation strip
 * (shown only when there is more than one photo), and a full-screen lightbox opened by activating a slide.
 *
 * Pattern: the lightbox is the house **Radix `Dialog`** (per B6) — Radix owns the focus trap, Escape-to-
 * dismiss, background inert, and focus-return to the activating slide, so this component hand-rolls none of
 * that (`aria-modal` div). The open slide is ephemeral, self-contained view state (`activeIndex`), not data
 * or a behavior-switching prop, so it stays local to this interactive widget rather than lifting to the
 * orchestration container (nothing else consumes it — YAGNI).
 *
 * B7: offscreen slides are `loading="lazy"` so a 10-photo recipe does not eagerly paint ~50 MB of
 * full-size originals; the lightbox image is eager (the user asked to see it). A service-side gallery
 * thumbnail rendition remains the fuller fix (tracked with the gallery projection) — out of scope here.
 */
import { useMessages } from '@commise/i18n/react';
import type { RecipePhoto } from '@kitchensink/recipe-core';
import * as Dialog from '@radix-ui/react-dialog';
import { useState, type FC } from 'react';

import { fillTemplate } from '../list/model.js';
import { recipeMessages } from '../messages.js';

/** Props for {@link PhotoCarousel} — the recipe's photos (display order) and the recipe title for alt text. */
export interface PhotoCarouselProps {
    readonly photos: readonly RecipePhoto[];
    readonly title: string;
}

/** A visually-hidden utility class (screen-reader-only) matching the app's Tailwind `sr-only` convention. */
const srOnly = 'sr-only';

export const PhotoCarousel: FC<PhotoCarouselProps> = ({ photos, title }) => {
    const { detail } = useMessages(recipeMessages);
    const [activeIndex, setActiveIndex] = useState<number | null>(null);

    if (photos.length === 0) {
        return null;
    }

    const altFor = (index: number): string => fillTemplate(detail.photoAlt, { title, index: index + 1 });
    const activePhoto = activeIndex !== null ? photos[activeIndex] : undefined;

    return (
        <section aria-label={detail.photosLabel} className="flex flex-col gap-3">
            <ul className="flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth">
                {photos.map((photo, index) => (
                    <li key={photo.id} id={`recipe-photo-${photo.id}`} className="shrink-0 snap-center basis-full">
                        <button
                            type="button"
                            aria-label={fillTemplate(detail.photoOpen, { title, index: index + 1 })}
                            onClick={() => setActiveIndex(index)}
                            className="block w-full overflow-hidden rounded-2xl"
                        >
                            <img
                                src={photo.url}
                                alt={altFor(index)}
                                loading={index === 0 ? 'eager' : 'lazy'}
                                decoding="async"
                                className="aspect-[4/3] w-full object-cover"
                            />
                        </button>
                    </li>
                ))}
            </ul>

            {photos.length > 1 && (
                <ol aria-label={detail.photoDotsLabel} className="flex items-center justify-center gap-2">
                    {photos.map((photo, index) => (
                        <li key={photo.id}>
                            {/* Touch floor: a 10px dot is far below the 44px minimum, so the HIT AREA grows to
                                `size-11` at base (collapsing to `sm:size-4` for the mouse) while the visible
                                dot stays 10px — the strip still reads as dots, but every one is tappable. */}
                            <a
                                href={`#recipe-photo-${photo.id}`}
                                aria-label={fillTemplate(detail.photoDot, { title, index: index + 1 })}
                                className="flex size-11 items-center justify-center sm:size-4"
                            >
                                <span
                                    aria-hidden
                                    className="block size-2.5 rounded-full bg-mist transition hover:bg-seafoam"
                                />
                            </a>
                        </li>
                    ))}
                </ol>
            )}

            <Dialog.Root open={activeIndex !== null} onOpenChange={(open) => !open && setActiveIndex(null)}>
                <Dialog.Portal>
                    <Dialog.Overlay className="fixed inset-0 z-50 bg-charcoal/80" />
                    <Dialog.Content className="fixed inset-0 z-50 flex items-center justify-center p-4">
                        <Dialog.Title className={srOnly}>
                            {activeIndex !== null ? altFor(activeIndex) : ''}
                        </Dialog.Title>
                        {activePhoto !== undefined && activeIndex !== null && (
                            <img
                                src={activePhoto.url}
                                alt={altFor(activeIndex)}
                                className="max-h-full max-w-full rounded-lg object-contain"
                            />
                        )}
                        <Dialog.Close
                            aria-label={detail.lightboxClose}
                            // Touch floor: `size-11` (44px) everywhere — this is overlay chrome on a
                            // full-screen image, so there is no desktop-density reason to shrink it.
                            className="absolute right-4 top-4 flex size-11 items-center justify-center rounded-full bg-card/90 text-charcoal shadow-lg transition hover:bg-card"
                        >
                            <span aria-hidden>×</span>
                        </Dialog.Close>
                    </Dialog.Content>
                </Dialog.Portal>
            </Dialog.Root>
        </section>
    );
};
