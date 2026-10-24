/**
 * @module @commise/ui/pushed-page — the shell's slot for the pinned bar (web). The app shell draws its connectivity notice
 * at the top of `<main>`, BEFORE the page, so a bar drawn by the page would come after the notice in reading and focus
 * order and the page would have two things above its Back. The shell offers a slot placed ahead of the notice; the
 * frame draws its bar into it (a portal), so Back is the first thing in `<main>` in the DOM, as it is on the screen.
 *
 * Without a slot (the first render, before the shell has mounted it; a test; a host with no notice) the frame draws the
 * bar in place, so the server-rendered page already has its Back.
 */
import { createContext } from 'react';

/** The element the frame draws its bar into, or `null` when the shell offers none. */
export const PinnedBarSlotContext = createContext<HTMLElement | null>(null);
