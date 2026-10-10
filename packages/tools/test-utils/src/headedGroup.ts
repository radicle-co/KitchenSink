/**
 * Find a group through the header that names it. On native a group carries no name when a header inside it says it:
 * the header names the group (`docs/design/nativeContainerNames.md` N1), so the group is the header's container.
 */
import { screen } from '@testing-library/react';

/**
 * The container of the one header named `name`, or `null` when no header has that name.
 *
 * @param name - The header's accessible name.
 * @returns The group element.
 * @throws When more than one header has that name, or the header has no container.
 * @sideEffect Reads the rendered document.
 */
export function queryHeadedGroup(name: string | RegExp): HTMLElement | null {
    const heading = screen.queryByRole('heading', { name });

    if (heading === null) {
        return null;
    }

    if (heading.parentElement === null) {
        throw new Error(`The header named ${String(name)} has no container.`);
    }

    return heading.parentElement;
}

/**
 * The container of the one header named `name`.
 *
 * @param name - The header's accessible name.
 * @returns The group element.
 * @throws When no header, or more than one, has that name.
 * @sideEffect Reads the rendered document.
 */
export function headedGroup(name: string | RegExp): HTMLElement {
    const group = queryHeadedGroup(name);

    if (group === null) {
        throw new Error(`There is no header named ${String(name)}.`);
    }

    return group;
}
