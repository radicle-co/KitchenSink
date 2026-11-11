/**
 * Integration: photos on a NEW recipe, and a finish that waits for them (owner report 2026-11-10; staff-ux SPECIFY and
 * staff-architect BLUEPRINT). Composes the REAL `useEditorPhotos` (the hold, the barrier), the real photo manager, queue
 * and upload hook, the shared `RecipePhotoManager` grid and the real `RecipeServiceClient` (request building and zod
 * parsing) — with only `fetch` doubled. What it proves that no unit test can:
 *
 * - a photo picked before the recipe has a title WAITS and reaches no server;
 * - once the recipe has an id the photo goes through the real wire in order: presign at the recipe's id, the direct
 *   PUT to the presigned address, then confirm — and the confirmed photo shows from the photos read;
 * - a finish (Publish) while a photo uploads holds the navigation until the confirm lands, and then goes once.
 */
import { RecipeServiceProvider } from '@kitchensink/recipe-service-client/hooks';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FC } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { makePhoto } from '../../src/__fixtures__/index.js';
import { useEditorPhotos } from '../../src/editor/useEditorPhotos.js';
import { RecipePhotoManager } from '../../src/photos/RecipePhotoManager.js';
import { json, twoOrigins, type RecordedRequest, type RouteAnswer } from './twoOrigins.js';

const RECIPE_ID = '0b7f8a52-3c1d-4e2f-9a6b-5c4d3e2f1a0b';
const PHOTO_ID = '6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f';
const PUT_URL = 'https://media.test/recipes/upload?signature=abc';
const STORED = makePhoto({ id: PHOTO_ID, recipeId: RECIPE_ID, key: 'recipes/k1.png', url: 'https://cdn.test/k1.png' });

/** The service's photo routes: what the editor's photo session talks to. */
/** What the service holds: whether the photo is confirmed, and how the confirm answers. */
interface PhotoServer {
    confirmed: boolean;
    confirm: () => RouteAnswer | Promise<RouteAnswer>;
}

function photoRoutes(state: PhotoServer) {
    return ({ method, path }: RecordedRequest): RouteAnswer | Promise<RouteAnswer> => {
        switch (`${method} ${path}`) {
            case `POST /api/v1/recipes/${RECIPE_ID}/photos/upload-url`:
                return json({ uploadUrl: PUT_URL, key: 'recipes/k1.png', expiresIn: 900, maxBytes: 5_242_880 });
            case `POST /api/v1/recipes/${RECIPE_ID}/photos/confirm`:
                return state.confirm();
            case `GET /api/v1/recipes/${RECIPE_ID}/photos`:
                return json(state.confirmed ? [STORED] : []);
            default:
                return json({ code: 'NOT_FOUND', message: path }, 404);
        }
    };
}

interface HostProps {
    readonly recipeId: string | undefined;
    readonly draftFloorMet: boolean;
    readonly titleMissing: boolean;
    readonly onCheckpoint: () => void;
    readonly onFinished: () => void;
}

/** A new recipe's Photos section: the grid over the editor's photo session, an add control and a Publish. */
const Host: FC<HostProps> = ({ recipeId, draftFloorMet, titleMissing, onCheckpoint, onFinished }) => {
    const photos = useEditorPhotos({ recipeId, draftFloorMet, titleMissing, checkpoint: onCheckpoint });
    const { manager } = photos;

    return (
        <>
            <RecipePhotoManager
                photos={manager.photos}
                onRemovePhoto={manager.removePhoto}
                removingPhotoId={manager.removingPhotoId}
                uploading={manager.uploading}
                errorMessage={manager.errorMessage}
                queueItems={manager.queue.items}
                onRetryQueueItem={manager.queue.retry}
                onRemoveQueueItem={manager.queue.remove}
                addControl={
                    <button
                        type="button"
                        onClick={() =>
                            manager.enqueuePicked(
                                [
                                    {
                                        blob: new Blob(['png']),
                                        fileName: 'soup.png',
                                        contentType: 'image/png',
                                        fileSize: 3,
                                    },
                                ],
                                'add',
                            )
                        }
                    >
                        Add a photo
                    </button>
                }
            />
            <button type="button" onClick={() => photos.finishWhenSettled(onFinished)}>
                Publish
            </button>
            <p>{photos.finish === undefined ? 'not waiting' : `waiting: ${photos.finish.kind}`}</p>
        </>
    );
};

const s3 = vi.fn<(url: string, init: RequestInit) => Promise<Response>>();

beforeEach(() => {
    s3.mockReset().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', s3);
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

function renderHost(state: PhotoServer) {
    const origins = twoOrigins({ recipe: photoRoutes(state) });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const onCheckpoint = vi.fn();
    const onFinished = vi.fn();
    const tree = (props: Pick<HostProps, 'recipeId' | 'draftFloorMet' | 'titleMissing'>) => (
        <QueryClientProvider client={queryClient}>
            <RecipeServiceProvider client={origins.recipes}>
                <Host {...props} onCheckpoint={onCheckpoint} onFinished={onFinished} />
            </RecipeServiceProvider>
        </QueryClientProvider>
    );
    const view = render(tree({ recipeId: undefined, draftFloorMet: false, titleMissing: true }));

    return {
        rerender: (props: Pick<HostProps, 'recipeId' | 'draftFloorMet' | 'titleMissing'>) => view.rerender(tree(props)),
        sent: () => origins.sentTo('recipe').map((request) => `${request.method} ${request.path}`),
        onCheckpoint,
        onFinished,
    };
}

describe('Photos on a new recipe', () => {
    it('waits for a title, then for the recipe, then goes presign → PUT → confirm and shows the stored photo', async () => {
        const state: PhotoServer = {
            confirmed: false,
            confirm: () => {
                state.confirmed = true;

                return json(STORED, 201);
            },
        };
        const host = renderHost(state);

        await userEvent.click(screen.getByRole('button', { name: 'Add a photo' }));

        expect(screen.getByRole('status', { name: 'Waiting to upload' })).toBeTruthy();
        expect(host.onCheckpoint).toHaveBeenCalledExactlyOnceWith('photoPicked');
        expect(host.sent()).toEqual([]);
        expect(s3).not.toHaveBeenCalled();

        host.rerender({ recipeId: undefined, draftFloorMet: true, titleMissing: false });
        expect(screen.getByRole('status', { name: 'Queued' })).toBeTruthy();
        expect(host.sent()).toEqual([]);

        host.rerender({ recipeId: RECIPE_ID, draftFloorMet: true, titleMissing: false });

        expect(await screen.findByRole('img', { name: 'Recipe photo 1' })).toBeTruthy();
        expect(host.sent().filter((route) => route.startsWith('POST'))).toEqual([
            `POST /api/v1/recipes/${RECIPE_ID}/photos/upload-url`,
            `POST /api/v1/recipes/${RECIPE_ID}/photos/confirm`,
        ]);
        expect(s3).toHaveBeenCalledExactlyOnceWith(PUT_URL, expect.objectContaining({ method: 'PUT' }));
    });

    it('holds Publish while a photo is still being confirmed, then goes once it lands', async () => {
        let answerConfirm: () => void = () => undefined;
        const state: PhotoServer = {
            confirmed: false,
            // The confirm waits until the test answers it: the photo is mid-upload when the cook publishes.
            confirm: () =>
                new Promise<RouteAnswer>((resolve) => {
                    answerConfirm = () => {
                        state.confirmed = true;
                        resolve(json(STORED, 201));
                    };
                }),
        };
        const host = renderHost(state);
        host.rerender({ recipeId: RECIPE_ID, draftFloorMet: true, titleMissing: false });

        await userEvent.click(screen.getByRole('button', { name: 'Add a photo' }));
        await waitFor(() => expect(host.sent()).toContain(`POST /api/v1/recipes/${RECIPE_ID}/photos/confirm`));

        await userEvent.click(screen.getByRole('button', { name: 'Publish' }));

        expect(screen.getByText('waiting: uploading')).toBeTruthy();
        expect(host.onFinished).not.toHaveBeenCalled();

        await act(async () => answerConfirm());

        await waitFor(() => expect(host.onFinished).toHaveBeenCalledOnce());
        expect(screen.getByText('not waiting')).toBeTruthy();
    });
});
