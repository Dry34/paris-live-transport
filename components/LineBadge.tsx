import type { LineInfo, Mode } from '@/lib/types';

type BadgeLine = Pick<LineInfo, 'shortName' | 'mode' | 'color' | 'textColor'>;

// Line pastille following Paris signage shapes: round for the metro, rounded square
// for RER and Transilien, pill framed by two bars for the tram.
export function LineBadge({ line, size = 'md' }: { line: BadgeLine; size?: 'sm' | 'md' | 'lg' }) {
  const style = line.mode === 'tram' ? { borderColor: line.color } : { background: line.color, color: line.textColor };
  return (
    <span className={`badge badge-${line.mode} badge-${size}`} style={style} aria-hidden="true">
      {line.shortName}
    </span>
  );
}

export const MODE_LABELS: Record<Mode, string> = {
  metro: 'Métro',
  rer: 'RER',
  tram: 'Tram',
  transilien: 'Transilien',
};

/** Accessible spoken name of a line, e.g. "Métro 4", "RER B", "Tram T3a", "Transilien J". */
export function lineName(line: Pick<LineInfo, 'shortName' | 'mode'>): string {
  return line.mode === 'tram' ? `Tram ${line.shortName}` : `${MODE_LABELS[line.mode]} ${line.shortName}`;
}
