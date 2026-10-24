/**
 * @module @commise/ui/main-element — the shell's `<main>`, handed to the page it holds (web). A page that sizes itself to
 * the main column (`useMainContainerClass`) measures THIS element, never `document.querySelector('main')`: during a load
 * the document can hold a second, hidden `<main>` ahead of the shell's, and measuring that one left Discover's filter
 * panel a Filters button at 1440 px (measured 2026-10-24, `useMainContainerClass.test.tsx`).
 *
 * `undefined` (the default) means no shell provides one (a canvas board, a test); `null` means the shell has not
 * mounted its `<main>` yet, which is the first render, so a server render and its hydration agree.
 */
import { createContext } from 'react';

/** The shell's `<main>`, `null` before it mounts, or `undefined` outside a shell. */
export const MainElementContext = createContext<HTMLElement | null | undefined>(undefined);
