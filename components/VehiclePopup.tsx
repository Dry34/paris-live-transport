'use client';
// Rich card of the selected train: where it goes, its coming stops up to the terminus, the line's rolling stock
// (side view in its livery, model name opening a photo, SNCF mission and train number) and a few running figures
// (speed, delay, data age, gaps to the trains ahead and behind).
import { useState, type CSSProperties } from 'react';
import type { Network, VehicleRun } from '@/lib/types';
import type { RunPosition } from '@/lib/client/interpolate';
import {
  cardRows,
  currentDelaySec,
  dataAgeText,
  estimatedSpeedKmh,
  formatDelay,
  clockTime,
  formatEta,
  gapText,
  neighborGaps,
  upcomingStops,
  type UpcomingStop,
} from '@/lib/client/vehicleDetails';
import { stockForLine, stockLabel } from '@/lib/rollingStock';
import { missionText, runUnits } from '@/lib/client/trainProfile';
import { LineBadge, lineName } from './LineBadge';
import { TrainIllustration } from './TrainIllustration';

export interface VehiclePopupProps {
  network: Network;
  run: VehicleRun;
  runs: VehicleRun[];
  position: RunPosition;
  fetchedAt: number;
  now: number;
  onOpenLine: (lineId: string) => void;
}

/** Screen-reader wording of a gap, matching gapText's "<1" for gaps under a minute. */
const gapMinutes = (min: number) => (min < 1 ? 'moins d’une min' : `${min} min`);

function StopRow({ stop, network, now, major, next, terminus = false }: { stop: UpcomingStop; network: Network; now: number; major: boolean; next: boolean; terminus?: boolean }) {
  return (
    <li className={`vc-stop${major ? ' is-major' : ''}${next ? ' is-next' : ''}`}>
      <span className="vc-dot" aria-hidden="true" />
      <div className="vc-stop-main">
        <span className="vc-stop-name">{stop.name}</span>
        {stop.correspondences.length > 0 && (
          <span className="vc-corr">
            {stop.correspondences.map((id) => (
              <LineBadge key={id} line={network.lines[id]} size="sm" />
            ))}
            <span className="sr-only">Correspondances : {stop.correspondences.map((id) => lineName(network.lines[id])).join(', ')}</span>
          </span>
        )}
      </div>
      <span className="vc-stop-time">
        {stop.atPlatform ? 'à quai' : formatEta(stop.time, now, stop.estimated)}
        {terminus && !stop.atPlatform && <span className="vc-stop-clock"> · {stop.estimated ? '~' : ''}{clockTime(stop.time)}</span>}
      </span>
    </li>
  );
}

export function VehiclePopup({ network, run, runs, position, fetchedAt, now, onOpenLine }: VehiclePopupProps) {
  const [expanded, setExpanded] = useState(false);
  // Model whose photo is shown in place of the profile; the image is only requested once this is set.
  const [photoOf, setPhotoOf] = useState<string | null>(null);
  const line = network.lines[run.lineId];
  const stops = upcomingStops(run, network, now);
  const { head, hidden, terminus } = cardRows(stops);
  const speed = estimatedSpeedKmh(run, position, network);
  const delay = formatDelay(currentDelaySec(run, position));
  const { aheadMin, behindMin } = neighborGaps(run, runs, network, now);
  const destination = run.destination || terminus?.name || '';
  const hasGaps = aheadMin !== null || behindMin !== null;
  const models = stockForLine(run.lineId);
  const model = models[0] ?? null;
  const modelName = stockLabel(models);
  const photo = model?.photo ?? null;
  const showPhoto = photo !== null && photoOf === model?.id;
  const mission = missionText(run);
  const row = (stop: UpcomingStop, i: number, major = false) => (
    <StopRow key={`${stop.quay}-${i}`} stop={stop} network={network} now={now} major={major || i === 0} next={i === 0} terminus={major && i > 0} />
  );

  return (
    <div className="vehicle-popup" style={{ '--line': line.color } as CSSProperties}>
      <button type="button" className="vc-head" onClick={() => onOpenLine(run.lineId)} aria-label={`Voir la ligne ${lineName(line)}`}>
        <LineBadge line={line} size="lg" />
        <span className="vc-dest">{destination}</span>
        <span className="vc-chevron" aria-hidden="true">
          ›
        </span>
      </button>

      {terminus ? (
        <ol className="vc-stops" aria-label="Prochains arrêts">
          {head.map((s, i) => row(s, i))}
          {hidden.length > 0 && (
            <li className={`vc-fold${expanded ? ' is-open' : ''}`}>
              <button type="button" className="vc-fold-button" aria-expanded={expanded} onClick={() => setExpanded((e) => !e)}>
                {expanded ? 'Replier' : `+${hidden.length} arrêt${hidden.length > 1 ? 's' : ''}`}
              </button>
            </li>
          )}
          {expanded && hidden.map((s, i) => row(s, head.length + i))}
          {row(terminus, head.length + hidden.length, true)}
        </ol>
      ) : (
        <p className="vc-empty">Aucun arrêt à venir connu</p>
      )}

      {showPhoto ? (
        <figure className="vc-photo">
          {/* Plain <img>: a Commons thumbnail, no next.config change and nothing fetched before the click. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photo.url} alt={`${model.name}, photo`} loading="lazy" />
          <figcaption>
            <a href={photo.page} target="_blank" rel="noopener noreferrer">
              Photo : {photo.author}, {photo.license}
            </a>
          </figcaption>
        </figure>
      ) : (
        <TrainIllustration mode={line.mode} color={line.color} model={model} units={runUnits(run)} />
      )}
      {(modelName || mission) && (
        <p className="vc-stock">
          {modelName &&
            (photo ? (
              <button type="button" className="vc-model" aria-pressed={showPhoto} title={showPhoto ? 'Revenir au profil' : 'Voir une photo'} onClick={() => setPhotoOf(showPhoto ? null : model.id)}>
                {modelName}
                <span className="sr-only">{showPhoto ? ' : revenir au profil' : ' : voir une photo'}</span>
              </button>
            ) : (
              <span className="vc-model">{modelName}</span>
            ))}
          {mission && <span className="vc-mission">{mission}</span>}
        </p>
      )}

      <div className="vc-foot">
        <p className="vc-figures">
          {speed !== null && <span>~{speed} km/h</span>}
          {delay && <span className={`vc-delay is-${delay.tone}`}>{delay.text}</span>}
          <span>{dataAgeText(fetchedAt, now)}</span>
        </p>
        {hasGaps && (
          <p className="vc-gaps">
            {aheadMin !== null && (
              <span>
                <span aria-hidden="true">‹ {gapText(aheadMin)}</span>
                <span className="sr-only">Rame devant : {gapMinutes(aheadMin)}.</span>
              </span>
            )}
            <LineBadge line={line} size="sm" />
            {behindMin !== null && (
              <span>
                <span aria-hidden="true">{gapText(behindMin)} ›</span>
                <span className="sr-only">Rame derrière : {gapMinutes(behindMin)}.</span>
              </span>
            )}
          </p>
        )}
      </div>
      <p className="vehicle-popup-note">Positions et horaires estimés</p>
    </div>
  );
}
