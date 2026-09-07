/**
 * Component tests for the mobile parse screens (react-native-web under jsdom).
 *
 * Both containers are driven through a REAL `RecipeServiceClient` with only its transport stubbed, so the
 * query key, the poll's enable gate, the outbound body parse and the response parse are all exercised —
 * the "live seam" shape `RecipeListScreen.liveSeam.native.test.tsx` establishes, and the only tier below
 * Maestro that can catch a client wired to the wrong method or the wrong argument order.
 *
 * What is asserted here is only what these containers own; the leaves' own states are covered in
 * `@commise/features-recipes`. Each of these is a way the mobile surface can break with that package fully
 * green:
 *
 *  - the pasted text is CONTAINER state, so typing must move it;
 *  - an inadmissible paste must never reach the client;
 *  - a created job's id must reach the composing screen (mobile has no URL to fall back on);
 *  - the review container must render the job the composing screen addressed, not a different one.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

import { recipeParseMessages } from '@commise/features-recipes';
import { RecipeServiceProvider } from '@kitchensink/recipe-service-client/hooks';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';
import type { ParseJobResponse, RecipeServiceClient } from '@kitchensink/recipe-service-client';

import { ParseIngredientsScreen } from '../../src/screens/ParseIngredientsScreen.js';
import { ParseJobReviewScreen } from '../../src/screens/ParseJobReviewScreen.js';

const messages = recipeParseMessages.en;
const JOB_ID = '00000000-0000-4000-8000-00000000d001';

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

function job(overrides: Partial<ParseJobResponse> = {}): ParseJobResponse {
    return {
        id: JOB_ID,
        status: 'complete',
        createdAt: '2026-09-02T11:59:00.000Z',
        // Far ahead, so the deadline never decides a case that is not about it.
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        lines: [
            {
                lineIndex: 0,
                sourceLine: '2 cups flour',
                status: 'parsed',
                proposal: {
                    raw: '2 cups flour',
                    quantity: { kind: 'exact', value: 2 },
                    unit: 'cup',
                    statedMeasure: '2 cups',
                    foods: [{ name: 'flour', prep: null }],
                    reviewReasons: [],
                },
            },
        ],
        ...overrides,
    };
}

/** Mount a screen inside the real provider stack, over a client whose transport `prepare` stubs. */
function renderScreen(ui: ReactNode, prepare: (client: RecipeServiceClient) => void = () => undefined) {
    const client = createFakeRecipeServiceClient();
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    prepare(client);
    render(
        createElement(
            QueryClientProvider,
            { client: queryClient },
            createElement(RecipeServiceProvider, { client, children: ui }),
        ),
    );

    return client;
}

describe('ParseIngredientsScreen (native)', () => {
    it('renders an empty paste surface with the control unavailable', () => {
        renderScreen(<ParseIngredientsScreen onCreated={vi.fn()} onBack={vi.fn()} />);

        expect(screen.getByLabelText(messages.pasteLabel)).toHaveProperty('value', '');
        expect(screen.getByRole('button', { name: messages.pasteSubmit }).getAttribute('aria-disabled')).toBe('true');
    });

    it('holds the pasted text — typing moves the field and the admissible count follows it', async () => {
        const user = userEvent.setup();
        renderScreen(<ParseIngredientsScreen onCreated={vi.fn()} onBack={vi.fn()} />);

        await user.type(screen.getByLabelText(messages.pasteLabel), '2 cups flour');

        expect(screen.getByLabelText(messages.pasteLabel)).toHaveProperty('value', '2 cups flour');
        expect(screen.getByText('1 line ready')).toBeTruthy();
    });

    it("⛔ reports the created job's id upward — mobile has no URL to recover it from", async () => {
        const user = userEvent.setup();
        const onCreated = vi.fn();
        let createParseJob: ReturnType<typeof vi.spyOn> | undefined;
        renderScreen(<ParseIngredientsScreen onCreated={onCreated} onBack={vi.fn()} />, (client) => {
            createParseJob = vi.spyOn(client, 'createParseJob').mockResolvedValue(job({ status: 'running' }));
        });

        await user.type(screen.getByLabelText(messages.pasteLabel), '2 cups flour');
        await user.click(screen.getByRole('button', { name: messages.pasteSubmit }));

        await waitFor(() => expect(onCreated).toHaveBeenCalledWith(JOB_ID));
        expect(createParseJob).toHaveBeenCalledWith({ text: '2 cups flour' });
    });

    it('⛔ never sends an inadmissible paste, and does not navigate', async () => {
        const user = userEvent.setup();
        const onCreated = vi.fn();
        let createParseJob: ReturnType<typeof vi.spyOn> | undefined;
        renderScreen(<ParseIngredientsScreen onCreated={onCreated} onBack={vi.fn()} />, (client) => {
            createParseJob = vi.spyOn(client, 'createParseJob');
        });

        // ⚠️ PASTE, not `type`. `user.type` dispatches one event PER CHARACTER, so a 1001-character
        // boundary case fired 1001 of them and exceeded the test timeout whenever the suite ran under
        // parallel load (green alone, red under `turbo run test`) — and its timeout then polluted the
        // following case, which types twelve characters and had nothing wrong with it. Pasting is also what
        // the screen is FOR: this is the over-length guard on a paste box, and no cook types a thousand
        // characters by hand.
        await user.click(screen.getByLabelText(messages.pasteLabel));
        await user.paste('x'.repeat(1001));

        expect(screen.getByText('Line 1 is longer than 1000 characters. Shorten it and try again.')).toBeTruthy();
        expect(createParseJob).not.toHaveBeenCalled();
        expect(onCreated).not.toHaveBeenCalled();
    });

    it('⚠️ keeps the pasted text when the create fails, and does not navigate', async () => {
        const user = userEvent.setup();
        const onCreated = vi.fn();
        renderScreen(<ParseIngredientsScreen onCreated={onCreated} onBack={vi.fn()} />, (client) => {
            vi.spyOn(client, 'createParseJob').mockRejectedValue(new Error('boom'));
        });

        await user.type(screen.getByLabelText(messages.pasteLabel), '2 cups flour');
        await user.click(screen.getByRole('button', { name: messages.pasteSubmit }));

        expect(await screen.findByText(messages.pasteFailed)).toBeTruthy();
        expect(screen.getByLabelText(messages.pasteLabel)).toHaveProperty('value', '2 cups flour');
        expect(onCreated).not.toHaveBeenCalled();
    });
});

describe('ParseJobReviewScreen (native)', () => {
    it('renders the job the composing screen addressed', async () => {
        let getParseJob: ReturnType<typeof vi.spyOn> | undefined;
        renderScreen(<ParseJobReviewScreen jobId={JOB_ID} onStartOver={vi.fn()} onBack={vi.fn()} />, (client) => {
            getParseJob = vi.spyOn(client, 'getParseJob').mockResolvedValue(job());
        });

        expect(await screen.findByText('2 cups flour')).toBeTruthy();
        expect(screen.getByText('1 of 1 lines read')).toBeTruthy();
        expect(getParseJob).toHaveBeenCalledWith(JOB_ID);
    });

    it('shows the loading state while the first view is in flight', () => {
        renderScreen(<ParseJobReviewScreen jobId={JOB_ID} onStartOver={vi.fn()} onBack={vi.fn()} />, (client) => {
            vi.spyOn(client, 'getParseJob').mockReturnValue(new Promise(() => undefined));
        });

        expect(screen.getByText(messages.loading)).toBeTruthy();
    });

    it('⛔ renders an expired job, and offers NO retry — the server answers 409 to one', async () => {
        renderScreen(<ParseJobReviewScreen jobId={JOB_ID} onStartOver={vi.fn()} onBack={vi.fn()} />, (client) => {
            vi.spyOn(client, 'getParseJob').mockResolvedValue(job({ status: 'expired' }));
        });

        expect(await screen.findByText(messages.expired)).toBeTruthy();
        expect(screen.queryByRole('button', { name: messages.retryAction })).toBeNull();
    });

    it('re-drives a settling job through the retry control', async () => {
        const user = userEvent.setup();
        let retryParseJob: ReturnType<typeof vi.spyOn> | undefined;
        renderScreen(<ParseJobReviewScreen jobId={JOB_ID} onStartOver={vi.fn()} onBack={vi.fn()} />, (client) => {
            vi.spyOn(client, 'getParseJob').mockResolvedValue(
                job({
                    status: 'partial',
                    lines: [{ lineIndex: 0, sourceLine: 'x', status: 'failed_retryable', proposal: null }],
                }),
            );
            retryParseJob = vi.spyOn(client, 'retryParseJob').mockResolvedValue(job({ status: 'running' }));
        });

        expect(await screen.findByText(messages.settling)).toBeTruthy();
        await user.click(screen.getByRole('button', { name: messages.retryAction }));

        await waitFor(() => expect(retryParseJob).toHaveBeenCalledWith(JOB_ID));
    });

    it('⛔ reports "back" upward — the screen must not be a dead end on a stack with no chrome', async () => {
        // This assertion is here because its ABSENCE let a real miss through: `onBack` was declared on the
        // props and never forwarded to the leaf, and every test still passed. eslint's unused-arg rule
        // caught it; a test should have.
        const user = userEvent.setup();
        const onBack = vi.fn();
        renderScreen(<ParseJobReviewScreen jobId={JOB_ID} onStartOver={vi.fn()} onBack={onBack} />, (client) => {
            vi.spyOn(client, 'getParseJob').mockResolvedValue(job());
        });

        // ⚠️ Settle on the READY state before querying the control. The `loading` branch renders its own
        // back button, so a `findByRole` that resolves there hands back a node React detaches a tick later
        // when the job lands — and clicking a detached node silently does nothing. (That is exactly how the
        // first version of this test failed, and it is worth the extra line to state.)
        await screen.findByText('2 cups flour');
        await user.click(screen.getByRole('button', { name: messages.backAction }));

        expect(onBack).toHaveBeenCalledTimes(1);
    });

    it('reports "start over" upward so the stack — not this screen — decides where it goes', async () => {
        const user = userEvent.setup();
        const onStartOver = vi.fn();
        renderScreen(<ParseJobReviewScreen jobId={JOB_ID} onStartOver={onStartOver} onBack={vi.fn()} />, (client) => {
            vi.spyOn(client, 'getParseJob').mockResolvedValue(job());
        });

        await user.click(await screen.findByRole('button', { name: messages.startOverAction }));

        expect(onStartOver).toHaveBeenCalledTimes(1);
    });
});
