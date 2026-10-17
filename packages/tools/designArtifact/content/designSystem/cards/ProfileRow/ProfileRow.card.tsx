/**
 * @module ProfileRow.card — the design-system card of ProfileRow: a group of value, long-value and busy rows, and a
 * group of danger rows with hints and an inert row, on both platforms.
 */
import type { ReactNode } from 'react';

import { defineCard } from '../../../../src/cards/defineCard.js';

const noop = (): void => undefined;

export default defineCard({
    group: 'Account',
    height: 460,
    platforms: 'both',
    uses: ['ProfileRow'],
    render: ({ ProfileRow }, { platform }) => {
        const group = (...rows: readonly ReactNode[]) => (
            <div
                style={{
                    background: 'var(--paper)',
                    border: '1px solid var(--line-divider)',
                    borderRadius: 12,
                    overflow: 'hidden',
                    maxWidth: platform === 'native' ? 358 : 420,
                }}
            >
                {rows.map((row, index) => (
                    <div
                        key={index}
                        style={{
                            display: 'flex',
                            flexDirection: 'column',
                            borderTop: index > 0 ? '1px solid var(--line-divider)' : 'none',
                        }}
                    >
                        {row}
                    </div>
                ))}
            </div>
        );

        return (
            <div className="col">
                {group(
                    <ProfileRow label="Display name" value="Maria Rossi" tone="ink" chevron onPress={noop} />,
                    <ProfileRow
                        label="Email"
                        value="maria.rossi.long.address@example.com"
                        tone="ink"
                        chevron={false}
                        onPress={noop}
                    />,
                    <ProfileRow label="Sign out" tone="ink" chevron={false} busy onPress={noop} />,
                )}
                {group(
                    <ProfileRow
                        label="Close account"
                        hint="Your recipes stay, but you will be signed out everywhere."
                        tone="danger"
                        chevron
                        onPress={noop}
                    />,
                    <ProfileRow
                        label="Erase account"
                        hint="Deletes your account and every recipe you wrote. This cannot be undone."
                        tone="danger"
                        chevron
                        onPress={noop}
                    />,
                    <ProfileRow label="Account closed" tone="danger" chevron={false} inert onPress={noop} />,
                )}
            </div>
        );
    },
});
