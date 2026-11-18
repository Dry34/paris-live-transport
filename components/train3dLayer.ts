// MapLibre custom layer drawing 3D train models at the trains' animated positions. Each model is cut into its cars
// (three.js, one InstancedMesh per car), and every car is set on the track so trains bend in curves. three.js is
// loaded lazily, only once the map is zoomed in enough.
import type { CustomLayerInterface, Map as MlMap } from 'maplibre-gl';
import type { LngLat } from '@/lib/types';
import {
  carPoses,
  carsOf,
  trainCars,
  headingRad,
  localMeters,
  mercatorUnitsPerMeter,
  MODEL_MIN_ZOOM,
  modelScale,
  toMercator,
  type CarSpec,
  type ModelSpec,
  type Track,
} from '@/lib/client/train3d';

/** A train to draw: its model, the track around it (null: drawn straight along its bearing) and its position. */
export interface Train3d { spec: ModelSpec; units: number; track: Track | null; coord: LngLat; bearing: number | null }

interface LoadedModel { cars: CarSpec[]; meshes: import('three').InstancedMesh[] }

export interface Train3dLayer extends CustomLayerInterface {
  /** Trains to draw on the next frame. */
  update(trains: Train3d[]): void;
}

const MAX_INSTANCES = 600;
/** Fixed origin near Paris: instance positions are metres around it (keeps float32 precise). */
const ORIGIN: LngLat = [2.35, 48.85];

type Three = typeof import('three');

/**
 * Splits a model into one geometry per car, each centred on its car: a connected part goes to the car its centre
 * falls in (x before rotation is the length axis).
 */
function splitCars(g: import('three').BufferGeometry, cars: CarSpec[]): import('three').BufferGeometry[] {
  const pos = g.getAttribute('position');
  const index = g.getIndex();
  const tri = (t: number, k: number) => (index ? index.getX(t * 3 + k) : t * 3 + k);
  const triCount = index ? index.count / 3 : pos.count / 3;
  const parent = Array.from({ length: pos.count }, (_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) x = parent[x] = parent[parent[x]];
    return x;
  };
  for (let t = 0; t < triCount; t++) {
    parent[find(tri(t, 0))] = find(tri(t, 1));
    parent[find(tri(t, 1))] = find(tri(t, 2));
  }
  const span = new Map<number, [number, number]>();
  for (let v = 0; v < pos.count; v++) {
    const r = find(v);
    const x = pos.getX(v);
    const s = span.get(r);
    if (s) span.set(r, [Math.min(s[0], x), Math.max(s[1], x)]);
    else span.set(r, [x, x]);
  }
  const carOf = (x: number) => {
    const i = cars.findIndex((c) => x <= c.center + c.half);
    return i < 0 ? cars.length - 1 : i;
  };
  const lists: number[][] = cars.map(() => []);
  for (let t = 0; t < triCount; t++) {
    const [lo, hi] = span.get(find(tri(t, 0)))!;
    lists[carOf((lo + hi) / 2)].push(tri(t, 0), tri(t, 1), tri(t, 2));
  }
  return lists.map((list, i) => {
    const part = g.clone();
    part.setIndex(list);
    part.translate(-cars[i].center, 0, 0);
    return part;
  });
}

export function createTrain3dLayer(id = 'trains-3d'): Train3dLayer {
  let map: MlMap | null = null;
  let three: Three | null = null;
  let renderer: import('three').WebGLRenderer | null = null;
  let scene: import('three').Scene | null = null;
  let camera: import('three').Camera | null = null;
  const models = new Map<string, LoadedModel | 'loading' | 'failed'>();
  let trains: Train3d[] = [];
  let loadingThree = false;

  const loadModel = (spec: ModelSpec) => {
    const url = spec.url;
    if (!three || !scene || models.has(url)) return;
    models.set(url, 'loading');
    const T = three;
    void import('three/examples/jsm/loaders/GLTFLoader.js')
      .then(({ GLTFLoader }) => new GLTFLoader().loadAsync(url))
      .then((gltf) => {
        let geometry: import('three').BufferGeometry | null = null;
        gltf.scene.traverse((o) => {
          if (!geometry && (o as import('three').Mesh).isMesh) geometry = (o as import('three').Mesh).geometry.clone();
        });
        if (!geometry || !scene) throw new Error(`no mesh in ${url}`);
        const g = geometry as import('three').BufferGeometry;
        g.rotateX(Math.PI / 2); // glTF is y-up; the map is z-up
        g.computeBoundingBox();
        g.translate(0, 0, -(g.boundingBox?.min.z ?? 0)); // wheels on the ground
        g.computeVertexNormals();
        const material = new T.MeshLambertMaterial({ vertexColors: g.hasAttribute('color'), color: g.hasAttribute('color') ? 0xffffff : 0xd0d4da });
        const cars = carsOf(spec);
        const meshes = splitCars(g, cars).map((part) => {
          const mesh = new T.InstancedMesh(part, material, MAX_INSTANCES);
          mesh.count = 0;
          mesh.frustumCulled = false;
          scene!.add(mesh);
          return mesh;
        });
        g.dispose();
        models.set(url, { cars, meshes });
        map?.triggerRepaint();
      })
      .catch((e) => {
        console.error('[trains-3d]', e);
        models.set(url, 'failed');
      });
  };

  const initThree = (gl: WebGL2RenderingContext | WebGLRenderingContext) => {
    if (three || loadingThree || !map) return;
    loadingThree = true;
    void import('three').then((T) => {
      if (!map) return;
      three = T;
      camera = new T.Camera();
      scene = new T.Scene();
      scene.add(new T.AmbientLight(0xffffff, 1.6));
      const sun = new T.DirectionalLight(0xffffff, 2);
      sun.position.set(-0.4, -0.6, 1);
      scene.add(sun);
      renderer = new T.WebGLRenderer({ canvas: map.getCanvas(), context: gl as WebGL2RenderingContext, antialias: true });
      renderer.autoClear = false;
      map.triggerRepaint();
    });
  };

  const matrix = { m: null as import('three').Matrix4 | null, q: null as import('three').Quaternion | null };

  return {
    id,
    type: 'custom',
    renderingMode: '3d',
    onAdd(m, gl) {
      map = m;
      if (m.getZoom() >= MODEL_MIN_ZOOM) initThree(gl);
    },
    onRemove() {
      renderer?.dispose();
      for (const model of models.values()) if (typeof model !== 'string') for (const mesh of model.meshes) mesh.geometry.dispose();
      models.clear();
      renderer = null;
      scene = null;
      map = null;
    },
    update(next) {
      trains = next;
      map?.triggerRepaint();
    },
    render(gl, options) {
      if (!map) return;
      const zoom = map.getZoom();
      if (zoom < MODEL_MIN_ZOOM) return;
      if (!three) return initThree(gl);
      if (!renderer || !scene || !camera) return;
      const T = three;
      matrix.m ??= new T.Matrix4();
      matrix.q ??= new T.Quaternion();
      const up = new T.Vector3(0, 0, 1);
      const k = modelScale(zoom, map.getCenter().lat);
      const scale = new T.Vector3(k.length, k.cross, k.cross);
      const counts = new Map<string, number>();
      const at = new T.Vector3();
      for (const t of trains) {
        const model = models.get(t.spec.url);
        if (model === undefined) loadModel(t.spec);
        if (!model || typeof model === 'string') continue;
        const i = counts.get(t.spec.url) ?? 0;
        if (i + t.units > MAX_INSTANCES) continue;
        const cars = trainCars(t.spec, t.units);
        const poses = t.track
          ? carPoses(t.track, cars, k.length, ORIGIN)
          : cars.map((c) => {
              // No track: straight along the bearing.
              const [e, n] = localMeters(ORIGIN, t.coord);
              const heading = t.bearing === null ? 0 : headingRad(t.bearing);
              return { e: e + Math.cos(heading) * c.center * k.length, n: n + Math.sin(heading) * c.center * k.length, heading };
            });
        poses.forEach((pose, c) => {
          matrix.q!.setFromAxisAngle(up, pose.heading);
          matrix.m!.compose(at.set(pose.e, pose.n, 0), matrix.q!, scale);
          // unit u of the train uses instance i + u of each car mesh
          model.meshes[cars[c].mesh].setMatrixAt(i + Math.floor(c / model.cars.length), matrix.m!);
        });
        counts.set(t.spec.url, i + t.units);
      }
      for (const [url, model] of models) {
        if (typeof model === 'string') continue;
        for (const mesh of model.meshes) {
          mesh.count = counts.get(url) ?? 0;
          mesh.instanceMatrix.needsUpdate = true;
        }
      }
      const [ox, oy] = toMercator(ORIGIN);
      const s = mercatorUnitsPerMeter(ORIGIN[1]);
      const local = new T.Matrix4().makeTranslation(ox, oy, 0).scale(new T.Vector3(s, -s, s));
      camera.projectionMatrix = new T.Matrix4().fromArray(options.defaultProjectionData.mainMatrix as unknown as number[]).multiply(local);
      renderer.resetState();
      renderer.render(scene, camera);
    },
  };
}
