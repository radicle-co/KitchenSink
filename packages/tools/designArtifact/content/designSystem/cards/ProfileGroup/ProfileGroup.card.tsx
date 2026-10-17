/**
 * @module ProfileGroup.card — the design-system card of the ProfileGroup: a headed preferences group, a labelled
 * read-only group and a danger-zone group with hints, on both platforms.
 */
import { defineCard } from '../../../../src/cards/defineCard.js';

const noop = (): void => undefined;

export default defineCard({
    group: 'Account',
    height: 560,
    platforms: 'both',
    uses: ['ProfileGroup', 'ProfileRow'],
    render: ({ ProfileGroup, ProfileRow }) => (
        <div className="col" style={{ gap: 24 }}>
            <ProfileGroup heading="Preferences">
                <ProfileRow label="Display name" value="Marta Silva" tone="ink" chevron onPress={noop} />
                <ProfileRow label="Measurement units" value="Metric" tone="ink" chevron onPress={noop} />
                <ProfileRow label="Language" value="English" tone="ink" chevron onPress={noop} />
            </ProfileGroup>
            <ProfileGroup label="Account">
                <ProfileRow label="Email" value="marta@example.com" tone="ink" chevron={false} onPress={noop} />
            </ProfileGroup>
            <ProfileGroup heading="Danger zone">
                <ProfileRow
                    label="Close account"
                    hint="Hides your recipes. You can reopen it later."
                    tone="danger"
                    chevron
                    onPress={noop}
                />
                <ProfileRow
                    label="Erase all my data"
                    hint="Deletes your account and every recipe. This cannot be undone."
                    tone="danger"
                    chevron
                    onPress={noop}
                />
            </ProfileGroup>
        </div>
    ),
});
