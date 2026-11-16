'use client';
// Live data for the map: static network once, vehicle snapshot every 30 s, disruptions every 2 min.
// On failure the last good data is kept and `error` carries a short French message.
import { useEffect, useState } from 'react';
import type { Disruption, Network, Snapshot } from '../types';

const VEHICLES_EVERY_MS = 30_000;
const DISRUPTIONS_EVERY_MS = 2 * 60_000;

export interface LiveData {
  network: Network | null;
  snapshot: Snapshot | null;
  disruptions: Disruption[];
  error: string | null;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    let message = `Erreur ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      /* body is not JSON: keep the status message */
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

export function useLiveData(): LiveData {
  const [network, setNetwork] = useState<Network | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [disruptions, setDisruptions] = useState<Disruption[]>([]);
  const [networkError, setNetworkError] = useState<string | null>(null);
  const [vehiclesError, setVehiclesError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getJson<Network>('/data/network.json')
      .then((n) => alive && setNetwork(n))
      .catch(() => alive && setNetworkError('Le plan du réseau n’a pas pu être chargé. Rechargez la page.'));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    const load = () =>
      getJson<Snapshot>('/api/vehicles')
        .then((s) => {
          if (!alive) return;
          setSnapshot(s);
          setVehiclesError(null);
        })
        .catch((e: unknown) => {
          if (!alive) return;
          const detail = e instanceof Error && !e.message.startsWith('Failed') ? ` (${e.message})` : '';
          setVehiclesError(`Positions non actualisées${detail}. La carte affiche le dernier relevé connu.`);
        });
    load();
    const timer = setInterval(load, VEHICLES_EVERY_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    const load = () =>
      getJson<Disruption[]>('/api/disruptions')
        .then((d) => alive && setDisruptions(d))
        .catch(() => {
          /* keep the previous list: disruptions are secondary information */
        });
    load();
    const timer = setInterval(load, DISRUPTIONS_EVERY_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  return { network, snapshot, disruptions, error: networkError ?? vehiclesError };
}
