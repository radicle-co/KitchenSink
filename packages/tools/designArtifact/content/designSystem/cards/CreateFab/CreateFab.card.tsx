/**
 * @module CreateFab.card — the design-system card of CreateFab: the extended button with three labels and icons,
 * each in a small stage that holds the otherwise screen-fixed button, on both platforms.
 */
import { defineCard } from '../../../../src/cards/defineCard.js';

const stageRules =
    '.fabStage{position:relative;transform:translateZ(0);height:90px;width:300px;border:1px solid var(--line-divider);border-radius:12px;background:var(--paper)}' +
    '.fabStage.fabStageNative{width:100%}' +
    '.fabStage button{display:inline-flex!important;position:absolute!important;bottom:16px!important}';

export default defineCard({
    group: 'Actions',
    height: 430,
    platforms: 'both',
    uses: ['CreateFab'],
    render: ({ CreateFab }, { platform }) => {
        const noop = (): void => undefined;
        const stage = (caption: string, label: string, icon: 'plus' | 'clipboardPaste') => (
            <div>
                <p style={{ fontSize: 12, color: 'var(--ink-muted)', margin: '0 0 4px' }}>{caption}</p>
                <div className={platform === 'native' ? 'fabStage fabStageNative' : 'fabStage'}>
                    <CreateFab label={label} icon={icon} onPress={noop} />
                </div>
            </div>
        );

        return (
            <div className="col">
                <style>{stageRules}</style>
                {stage('Extended: New recipe', 'New recipe', 'plus')}
                {stage('Extended: New collection', 'New collection', 'plus')}
                {stage('Extended: Paste a list', 'Paste a list', 'clipboardPaste')}
            </div>
        );
    },
});
