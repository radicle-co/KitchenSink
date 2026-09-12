/**
 * Component tests for `ParsePasteContainer` — the wiring between the shared paste leaf and the create
 * mutation, driven through a real `RecipeServiceClient` with only its transport stubbed.
 *
 * The leaf's own states are covered in `@commise/features-recipes`; what is asserted HERE is only what this
 * container owns, and each of the four is a way the surface can be broken without any test in that package
 * noticing:
 *
 *  1. The pasted text is CONTAINER state, so typing must actually move it (a leaf wired to a frozen value
 *     renders a field nobody can type in).
 *  2. A created job's id decides where the viewer LANDS, and it is a `replace` — a `push` would leave a
 *     Back press on a form still holding text for a job that already exists, and a second submit there
 *     would create a duplicate from the same paste.
 *  3. An inadmissible paste must never reach the client, which would throw `InvalidRequestError` from a
 *     control the cook was invited to press.
 *  4. A failed create must keep the text on screen — for a 200-line block, retyping is the whole cost.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { recipeParseMessages } from '@commise/features-recipes';
import { renderWithRecipeClient } from '@commise/test-utils';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';
import type { ParseJobResponse } from '@kitchensink/recipe-service-client';

import { ParsePasteContainer } from '@/components/recipes/ParsePasteContainer';

const messages = recipeParseMessages.en;
const JOB_ID = '00000000-0000-4000-8000-00000000d001';

const { replaceMock, pushMock } = vi.hoisted(() => ({ replaceMock: vi.fn(), pushMock: vi.fn() }));

vi.mock('next/navigation', () => ({
    useRouter: () => ({ replace: replaceMock, push: pushMock }),
}));

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.clearAllMocks();
});

function acceptedJob(): ParseJobResponse {
    return {
        id: JOB_ID,
        status: 'running',
        createdAt: '2026-09-02T11:59:00.000Z',
        expiresAt: '2026-09-03T11:59:00.000Z',
        lines: [{ lineIndex: 0, sourceLine: '2 cups flour', status: 'pending', proposal: null }],
    };
}

describe('ParsePasteContainer', () => {
    it('renders the paste surface with nothing typed and the control unavailable', () => {
        const client = createFakeRecipeServiceClient();

        renderWithRecipeClient(<ParsePasteContainer locale="en" />, client);

        expect(screen.getByLabelText(messages.pasteLabel)).toHaveProperty('value', '');
        expect((screen.getByRole('button', { name: messages.pasteSubmit }) as HTMLButtonElement).disabled).toBe(true);
    });

    it('holds the pasted text — typing moves the field and the admissible count follows it', async () => {
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();

        renderWithRecipeClient(<ParsePasteContainer locale="en" />, client);
        await user.type(screen.getByLabelText(messages.pasteLabel), '2 cups flour');

        expect(screen.getByLabelText(messages.pasteLabel)).toHaveProperty('value', '2 cups flour');
        expect(screen.getByText('1 line ready')).toBeTruthy();
    });

    it("⛔ REPLACES the route with the created job's own id, so Back does not return to a spent form", async () => {
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        const createParseJob = vi.spyOn(client, 'createParseJob').mockResolvedValue(acceptedJob());

        renderWithRecipeClient(<ParsePasteContainer locale="en" />, client);
        await user.type(screen.getByLabelText(messages.pasteLabel), '2 cups flour');
        await user.click(screen.getByRole('button', { name: messages.pasteSubmit }));

        await waitFor(() => expect(replaceMock).toHaveBeenCalledWith(`/en/recipes/parse/${JOB_ID}`));
        expect(createParseJob).toHaveBeenCalledWith({ text: '2 cups flour' });
        expect(pushMock).not.toHaveBeenCalled();
    });

    it('⛔ never sends an inadmissible paste — the control is unavailable and the client is untouched', async () => {
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        const createParseJob = vi.spyOn(client, 'createParseJob');

        renderWithRecipeClient(<ParsePasteContainer locale="en" />, client);
        await user.type(screen.getByLabelText(messages.pasteLabel), 'x'.repeat(1001));

        expect(screen.getByRole('alert').textContent).toContain('Line 1 is longer than 1000 characters');
        await user.click(screen.getByRole('button', { name: messages.pasteSubmit }));
        expect(createParseJob).not.toHaveBeenCalled();
        expect(replaceMock).not.toHaveBeenCalled();
    });

    it('announces the in-flight create and does not navigate until it lands', async () => {
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        // Never settles, so the in-flight state is observable rather than a race.
        vi.spyOn(client, 'createParseJob').mockReturnValue(new Promise(() => undefined));

        renderWithRecipeClient(<ParsePasteContainer locale="en" />, client);
        await user.type(screen.getByLabelText(messages.pasteLabel), '2 cups flour');
        await user.click(screen.getByRole('button', { name: messages.pasteSubmit }));

        expect(await screen.findByRole('status')).toHaveProperty('textContent', messages.pasteSubmitting);
        expect(replaceMock).not.toHaveBeenCalled();
    });

    it('⚠️ keeps the pasted text when the create fails, and lets the cook try again', async () => {
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        const createParseJob = vi.spyOn(client, 'createParseJob').mockRejectedValue(new Error('boom'));

        renderWithRecipeClient(<ParsePasteContainer locale="en" />, client);
        await user.type(screen.getByLabelText(messages.pasteLabel), '2 cups flour');
        await user.click(screen.getByRole('button', { name: messages.pasteSubmit }));

        expect(await screen.findByRole('alert')).toHaveProperty('textContent', messages.pasteFailed);
        expect(screen.getByLabelText(messages.pasteLabel)).toHaveProperty('value', '2 cups flour');
        expect(replaceMock).not.toHaveBeenCalled();

        createParseJob.mockResolvedValue(acceptedJob());
        await user.click(screen.getByRole('button', { name: messages.pasteSubmit }));

        await waitFor(() => expect(replaceMock).toHaveBeenCalledWith(`/en/recipes/parse/${JOB_ID}`));
    });
});
