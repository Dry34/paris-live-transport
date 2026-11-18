// MapLibre custom layer drawing 3D train models (three.js, one InstancedMesh per glTF file) at the
// trains' animated positions. three.js is loaded lazily, only once the map is zoomed in enough.
import type { CustomLayerInterface, Map as MlMap } from 'maplibre-gl';
import type { LngLat } from '@/lib/types';
import { headingRad, localMeters, mercatorUnitsPerMeter, MODEL_MIN_ZOOM, modelScale, toMercator } from '@/lib/client/train3d';

export interface Train3d { model: string; coord: LngLat; bearing: number | null }

export interface Train3dLayer extends CustomLayerInterface {
  /** Trains to draw on the next frame. */
  update(trains: Train3d[]): void;
}

const MAX_INSTANCES = 600;
/** Fixed origin near Paris: instance positions are metres around it (keeps float32 precise). */
const ORIGIN: LngLat = [2.35, 48.85];

type Three = typeof import('three');

export function createTrain3dLayer(id = 'trains-3d'): Train3dLayer {
  let map: MlMap | null = null;
  let three: Three | null = null;
  let renderer: import('three').WebGLRenderer | null = null;
  let scene: import('three').Scene | null = null;
  let camera: import('three').Camera | null = null;
  const meshes = new Map<string, import('three').InstancedMesh | 'loading' | 'failed'>();
  let trains: Train3d[] = [];
  let loadingThree = false;

  const loadModel = (url: string) => {
    if (!three || !scene || meshes.has(url)) return;
    meshes.set(url, 'loading');
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
        const mesh = new T.InstancedMesh(g, material, MAX_INSTANCES);
        mesh.count = 0;
        mesh.frustumCulled = false;
        scene.add(mesh);
        meshes.set(url, mesh);
        map?.triggerRepaint();
      })
      .catch((e) => {
        console.error('[trains-3d]', e);
        meshes.set(url, 'failed');
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
      for (const mesh of meshes.values()) if (typeof mesh !== 'string') mesh.geometry.dispose();
      meshes.clear();
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
      for (const t of trains) {
        const mesh = meshes.get(t.model);
        if (mesh === undefined) loadModel(t.model);
        if (!mesh || typeof mesh === 'string') continue;
        const i = counts.get(t.model) ?? 0;
        if (i >= MAX_INSTANCES) continue;
        const [e, n] = localMeters(ORIGIN, t.coord);
        matrix.q.setFromAxisAngle(up, t.bearing === null ? 0 : headingRad(t.bearing));
        matrix.m.compose(new T.Vector3(e, n, 0), matrix.q, scale);
        mesh.setMatrixAt(i, matrix.m);
        counts.set(t.model, i + 1);
      }
      for (const [url, mesh] of meshes) {
        if (typeof mesh === 'string') continue;
        mesh.count = counts.get(url) ?? 0;
        mesh.instanceMatrix.needsUpdate = true;
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
