/**
 * @module @commise/features-recipes/__fixtures__ — the editor surface over its real session, for the tests that tie the passive
 * Public line (ADR-0095) to the wording a write carries. The web and the native test files mount the same tree; only the
 * leaves (web or react-native-web) differ, which is what the pair proves.
 *
 * It reports what the cook could read when Publish was pressed and what then went on the wire, and nothing else.
 */
import { SnackbarHost } from '@commise/ui/snackbar';
import { LocaleProvider } from '@commise/i18n/react';
import { makeQuietFoodClient } from '@commise/test-utils';
import { FoodServiceProvider } from '@kitchensink/food-service-client/hooks';
import { RecipeServiceProvider } from '@kitchensink/recipe-service-client/hooks';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from '@testing-library/react';
import { useState, type ReactElement } from 'react';
import { vi } from 'vitest';

import { useRecipePrivate } from '../actions/useRecipePrivate.js';
import { recipeActionMessages } from '../actions/messages.js';
import type { DraftStore } from '../editor/draftStore.js';
import { RecipeEditorSurface } from '../editor/RecipeEditorSurface.js';
import { useRecipeEditorSession, type RecipeEditorSession } from '../editor/useRecipeEditorSession.js';
import type { RecipeFormValues } from '../form/values.js';
import type { EditorSeed } from '../hooks/useRecipeEditor.js';
import { makeFakeEditorWritePort } from './editorWritePort.js';

/** The passive line's words: what a cook reads under the Public card. */
export const CONFIRM_LINE = recipeActionMessages.en.publicConfirm.line;

const NO_DRAFTS: DraftStore = {
    load: async () => undefined,
    save: async () => undefined,
    discard: async () => undefined,
    adopt: async () => undefined,
    clear: async () => undefined,
};

function Harness(props: {
    readonly seed: EditorSeed;
    readonly locale: string;
    readonly port: ReturnType<typeof makeFakeEditorWritePort>;
    readonly onSession: (session: RecipeEditorSession) => void;
    readonly onWaitForPhotos: (wait: () => void) => void;
}): ReactElement {
    const { seed } = props;
    // The photo session reports a finish waiting: the surface then draws no visibility field.
    const [photoFinishWaiting, setPhotoFinishWaiting] = useState(false);
    const recipePrivate = useRecipePrivate({
        sourceType: seed.recipe?.sourceType,
        sourceKind: seed.recipe?.sourceKind ?? null,
        knownPaidFeatures: 'granted',
    });
    const session = useRecipeEditorSession({
        seed,
        locale: props.locale,
        keep: 'disk',
        port: props.port,
        drafts: NO_DRAFTS,
        navigation: { finished: vi.fn(), leftForRecipe: vi.fn(), discarded: vi.fn() },
        reportError: vi.fn(),
        openPaste: false,
        privateRefusal: recipePrivate.refusal,
    });
    props.onSession(session);
    props.onWaitForPhotos(() => setPhotoFinishWaiting(true));

    return (
        <RecipeEditorSurface
            session={
                photoFinishWaiting
                    ? { ...session, photos: { ...session.photos, finish: { kind: 'uploading' } } }
                    : session
            }
            seed={seed}
            mode={seed.recipe === undefined ? 'create' : 'edit'}
            keep="disk"
            paidFeatures="granted"
            knownPaidFeatures="granted"
            slotStanding={recipePrivate.standing}
            renderPhotos={() => null}
            onClose={vi.fn()}
            onOpenMyRecipes={vi.fn()}
            leaveAsk="inPage"
        />
    );
}

/**
 * Mount the surface with `render` (the platform's), and return the handles a scenario drives.
 *
 * @param renderTree - The test file's `render`.
 * @param seed - The editor's seed.
 * @param locale - The locale the screen asks for.
 * @returns `choose` (set the draft), `waitForPhotos` (a finish starts waiting, which hides the field), `publish` (press
 *   Publish), and `sentConfirmation` (whether a write carried the wording).
 * @sideEffect Mounts a React tree.
 */
export function mountConfirmLineSurface(
    renderTree: (tree: ReactElement) => unknown,
    seed: EditorSeed,
    locale = 'en',
): {
    readonly choose: (values: RecipeFormValues) => void;
    readonly waitForPhotos: () => void;
    readonly publish: () => void;
    readonly sentConfirmation: () => boolean;
    /** The locale each carried wording names. */
    readonly sentLocales: () => readonly string[];
    /** How many writes went out: a refused Publish sends none, and "no wording" would then prove nothing. */
    readonly writes: () => number;
} {
    const port = makeFakeEditorWritePort();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let session: RecipeEditorSession | undefined;
    let wait: (() => void) | undefined;

    renderTree(
        <LocaleProvider locale={locale}>
            <QueryClientProvider client={queryClient}>
                <RecipeServiceProvider client={createFakeRecipeServiceClient()}>
                    <FoodServiceProvider client={makeQuietFoodClient()} subject="user_cook">
                        <SnackbarHost>
                            <Harness
                                seed={seed}
                                locale={locale}
                                port={port}
                                onWaitForPhotos={(next) => {
                                    wait = next;
                                }}
                                onSession={(next) => {
                                    session = next;
                                }}
                            />
                        </SnackbarHost>
                    </FoodServiceProvider>
                </RecipeServiceProvider>
            </QueryClientProvider>
        </LocaleProvider>,
    );

    return {
        choose: (values) => {
            act(() => {
                session?.editor.setValues(values);
            });
        },
        waitForPhotos: () => {
            act(() => {
                wait?.();
            });
        },
        publish: () => {
            act(() => {
                session?.editor.publish('');
            });
        },
        writes: () => port.submitted.length,
        sentLocales: () =>
            port.submitted.flatMap((intent) => {
                const { input } = intent.payload as { input?: { publicConfirmation?: { locale: string } } };

                return input?.publicConfirmation === undefined ? [] : [input.publicConfirmation.locale];
            }),
        sentConfirmation: () =>
            port.submitted.some((intent) => {
                const { input } = intent.payload as { input?: Record<string, unknown> };

                return input !== undefined && 'publicConfirmation' in input;
            }),
    };
}
