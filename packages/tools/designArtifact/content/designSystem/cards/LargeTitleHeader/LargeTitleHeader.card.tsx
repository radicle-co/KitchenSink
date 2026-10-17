/**
 * @module LargeTitleHeader.card — the design-system card of LargeTitleHeader: a header with a back link, a
 * subtitle and a trailing action, and a plain header with only a title and subtitle, on both platforms at phone
 * width.
 */
import { defineCard } from '../../../../src/cards/defineCard.js';

const noop = (): void => undefined;

export default defineCard({
    group: 'Navigation',
    height: 280,
    platforms: 'both',
    staging: { phoneViewport: true },
    uses: ['Button', 'LargeTitleHeader'],
    render: ({ Button, LargeTitleHeader }, { platform }) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            <LargeTitleHeader
                headingId={`h1${platform}`}
                title="Weeknight dinners"
                subtitle="12 recipes"
                back={{ label: 'Back to Collections', parent: 'Collections', onPress: noop }}
                action={{
                    kind: 'controls',
                    button: (
                        <Button variant="secondary" size="sm" icon="arrowUp">
                            Share
                        </Button>
                    ),
                }}
            />
            <LargeTitleHeader headingId={`h2${platform}`} title="My recipes" subtitle="48 recipes" />
        </div>
    ),
});
