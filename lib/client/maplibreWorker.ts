// MapLibre 6 ships its worker as a separate ES module (dist/maplibre-gl-worker.mjs) that it locates next to its own
// module URL. Bundlers do not emit that file, so the worker fails to load and nothing renders. The app serves it from
// app/maplibre/worker.mjs/route.ts and points MapLibre at it with setWorkerUrl().

/** Same-origin URL of the MapLibre worker, versioned so that a maplibre-gl upgrade busts the browser cache. */
export function maplibreWorkerUrl(version: string): string {
  return `/maplibre/worker.mjs?v=${encodeURIComponent(version)}`;
}
