import type { FC } from 'react';

export interface UndocumentedProps {
    readonly label: string;
    readonly onSelect?: () => void;
}

export const Undocumented: FC<UndocumentedProps> = ({ label, onSelect }) => <button onClick={onSelect}>{label}</button>;
