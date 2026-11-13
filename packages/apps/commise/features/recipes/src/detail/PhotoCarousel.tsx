'use client';

/**
 * @module @commise/features-recipes — web recipe-photo carousel + lightbox (W2 Task 2.2, D2). It is the recipe
 * detail's hero (`RecipeHero`), so it is the screen's one photo surface (F2).
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
 * HERO PAGING (`nativeBoards/buildLists.md` item 1): paging chevrons at the sides and dots that track the page. The page is
 * state, read from the strip's scroll offset and set directly when a chevron is pressed; a chevron scrolls the next
 * slide into view (`block: 'nearest'`, so the page itself does not move). The slide pitch is read from the slides, not
 * assumed, so the strip's gap can change without breaking the rule.
 *
 * B7: offscreen slides are `loading="lazy"` so a 10-photo recipe does not eagerly paint ~50 MB of
 * full-size originals; the lightbox image is eager (the user asked to see it). A service-side gallery
 * thumbnail rendition remains the fuller fix (tracked with the gallery projection) — out of scope here.
 *
 * @pattern Adapter over the house Radix `Dialog` for the lightbox — Radix owns the focus trap, Escape-to-dismiss,
 *     background inert and focus-return to the activating slide; the open slide is local view state, not data.
 */
import { useMessages } from '@commise/i18n/react';
import { HeroButton } from '@commise/ui/hero-button';
import type { RecipePhoto } from '@kitchensink/recipe-core';
import * as Dialog from '@radix-ui/react-dialog';
import { useState, type FC, type UIEvent } from 'react';

import { fillTemplate } from '@commise/i18n';
import { recipeMessages } from '../messages.js';
import { pageAt } from './photoPaging.js';
import { FOCUS_RING_CLASS } from '@commise/ui/focus-ring';

/** Props for {@link PhotoCarousel} — the recipe's photos (display order) and the recipe title for alt text. */
export interface PhotoCarouselProps {
    readonly photos: readonly RecipePhoto[];
    readonly title: string;
}

/** A visually-hidden utility class (screen-reader-only) matching the app's Tailwind `sr-only` convention. */
const srOnly = 'sr-only';

/** The distance from one slide's start to the next's, read from the slides themselves; the strip's width for one slide. */
function slidePitch(strip: HTMLElement): number {
    const [first, second] = Array.from(strip.children).filter(
        (child): child is HTMLElement => child instanceof HTMLElement,
    );

    return first !== undefined && second !== undefined ? second.offsetLeft - first.offsetLeft : strip.clientWidth;
}

export const PhotoCarousel: FC<PhotoCarouselProps> = ({ photos, title }) => {
    const { detail } = useMessages(recipeMessages);
    const [activeIndex, setActiveIndex] = useState<number | null>(null);
    const [page, setPage] = useState(0);

    if (photos.length === 0) {
        return null;
    }

    const altFor = (index: number): string => fillTemplate(detail.photoAlt, { title, index: index + 1 });
    const activePhoto = activeIndex !== null ? photos[activeIndex] : undefined;

    const goTo = (next: number): void => {
        const slide = photos[next];

        if (slide === undefined) {
            return;
        }

        setPage(next);
        document
            .getElementById(`recipe-photo-${slide.id}`)
            ?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    };

    const onStripScroll = (event: UIEvent<HTMLElement>): void => {
        setPage(pageAt(event.currentTarget.scrollLeft, slidePitch(event.currentTarget), photos.length));
    };

    return (
        <section aria-label={detail.photosLabel} className="flex flex-col gap-3">
            <div className="relative">
                <ul onScroll={onStripScroll} className="flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth">
                    {photos.map((photo, index) => (
                        <li key={photo.id} id={`recipe-photo-${photo.id}`} className="shrink-0 snap-center basis-full">
                            <button
                                type="button"
                                aria-label={fillTemplate(detail.photoOpen, { title, index: index + 1 })}
                                onClick={() => setActiveIndex(index)}
                                className="block w-full overflow-hidden rounded-lg"
                            >
                                <img
                                    src={photo.url}
                                    alt={altFor(index)}
                                    loading={index === 0 ? 'eager' : 'lazy'}
                                    decoding="async"
                                    // The hero box (`specRecipeAndWizard.md` S2.1): 4:3 on a phone, never taller than 40% of the
                                    // window, so the title stays on a sideways phone's first screen; 16:9 up to 480 px from
                                    // `md`. The photo crops (`object-cover`) rather than squeezing.
                                    className="aspect-[4/3] max-h-[min(40vh,480px)] w-full object-cover md:aspect-video"
                                />
                            </button>
                        </li>
                    ))}
                </ul>
                {photos.length > 1 && page > 0 && (
                    <div className="absolute inset-y-0 start-2 flex items-center">
                        <HeroButton
                            icon="chevronLeft"
                            label={fillTemplate(detail.photoPrevious, { title })}
                            onPress={() => goTo(page - 1)}
                        />
                    </div>
                )}
                {photos.length > 1 && page < photos.length - 1 && (
                    <div className="absolute inset-y-0 end-2 flex items-center">
                        <HeroButton
                            icon="chevronRight"
                            label={fillTemplate(detail.photoNext, { title })}
                            onPress={() => goTo(page + 1)}
                        />
                    </div>
                )}
            </div>

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
                                aria-current={index === page ? 'true' : undefined}
                                className="flex size-11 items-center justify-center sm:size-4"
                            >
                                <span
                                    aria-hidden
                                    className={`block size-2.5 rounded-full transition hover:bg-action ${index === page ? 'bg-ink' : 'bg-line-divider'}`}
                                />
                            </a>
                        </li>
                    ))}
                </ol>
            )}

            <Dialog.Root open={activeIndex !== null} onOpenChange={(open) => !open && setActiveIndex(null)}>
                <Dialog.Portal>
                    <Dialog.Overlay className="fixed inset-0 z-50 bg-scrim" />
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
                            className={`absolute right-4 top-4 flex size-11 items-center justify-center rounded-full bg-paper text-ink shadow-lg transition hover:bg-paper ${FOCUS_RING_CLASS.floating}`}
                        >
                            <span aria-hidden>×</span>
                        </Dialog.Close>
                    </Dialog.Content>
                </Dialog.Portal>
            </Dialog.Root>
        </section>
    );
};
