// Generates public/models/mi09.glb: a simplified MI 09 unit (RER A) built from coloured boxes, in the style of the
// Francilien model. Usage: npx tsx scripts/models/make-mi09.ts
// glTF axes: x = length (centred on 0), y = up (0 = rail top), z = width. One unit: 5 cars, 112 m.
import { writeFileSync } from 'node:fs';
import path from 'node:path';

type RGB = [number, number, number];
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

const C = {
  body: hex('#f2f4f5'),
  blue: hex('#1d4f9c'),
  nose: hex('#5aa7dc'),
  red: hex('#d6262c'),
  glass: hex('#26323a'),
  door: hex('#3a4650'),
  roof: hex('#c4cad0'),
  skirt: hex('#4a535c'),
  bogie: hex('#2b2f33'),
  gangway: hex('#30363c'),
  light: hex('#fff6c8'),
  tail: hex('#c81e1e'),
};

const positions: number[] = [];
const colors: number[] = [];
const indices: number[] = [];

/** Axis-aligned box [x0,x1]×[y0,y1]×[z0,z1], each face with its own vertices (flat shading). */
function box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, rgb: RGB): void {
  const faces: [number, number, number][][] = [
    [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], // +x
    [[x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [x0, y0, z0]], // -x
    [[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]], // +y
    [[x0, y0, z1], [x0, y0, z0], [x1, y0, z0], [x1, y0, z1]], // -y
    [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], // +z
    [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], // -z
  ];
  for (const f of faces) {
    const base = positions.length / 3;
    for (const v of f) {
      positions.push(...v);
      colors.push(...rgb, 255);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}

const W = 2.9; // body width
const HALF = W / 2;
const SKIN = 0.02; // side decorations stand this far out of the body
const GAP = 0.4; // between two cars
const CARS = [23.6, 21.6, 21.6, 21.6, 23.6]; // car lengths (m)
const TOTAL = CARS.reduce((a, b) => a + b, 0);

/** A panel on both sides of the body, between x0 and x1, heights y0..y1. */
function sides(x0: number, x1: number, y0: number, y1: number, rgb: RGB, out = SKIN): void {
  box(x0, x1, y0, y1, HALF, HALF + out, rgb);
  box(x0, x1, y0, y1, -HALF - out, -HALF, rgb);
}

function car(x0: number, len: number, cab: 'none' | 'front' | 'rear'): void {
  const x1 = x0 + len;
  const cabLen = 3.2;
  const bodyX0 = x0 + GAP / 2;
  const bodyX1 = x1 - GAP / 2;
  // running gear and underframe
  for (const bx of [bodyX0 + 3.2, bodyX1 - 3.2]) box(bx - 1.3, bx + 1.3, 0.12, 0.95, -1.1, 1.1, C.bogie);
  box(bodyX0 + 0.3, bodyX1 - 0.3, 0.9, 1.15, -HALF + 0.15, HALF - 0.15, C.skirt);
  // body and roof
  box(bodyX0, bodyX1, 1.1, 4.05, -HALF, HALF, C.body);
  box(bodyX0 + 0.4, bodyX1 - 0.4, 4.05, 4.32, -HALF + 0.3, HALF - 0.3, C.roof);
  // blue lower band along the whole car
  sides(bodyX0, bodyX1, 1.1, 1.75, C.blue);
  // doors: 3 per side, red frame around a dark leaf
  const usableX0 = cab === 'front' ? bodyX0 + cabLen : bodyX0;
  const usableX1 = cab === 'rear' ? bodyX1 - cabLen : bodyX1;
  const span = usableX1 - usableX0;
  const doorXs = [0.18, 0.5, 0.82].map((f) => usableX0 + f * span);
  for (const dx of doorXs) {
    sides(dx - 1.15, dx + 1.15, 1.15, 3.45, C.red, SKIN * 2);
    sides(dx - 0.95, dx + 0.95, 1.2, 3.3, C.door, SKIN * 3);
    sides(dx - 0.05, dx + 0.05, 1.2, 3.3, C.glass, SKIN * 4); // leaf joint
  }
  // window bands (lower and upper deck) between the doors
  const stops = [usableX0 + 0.5, ...doorXs.flatMap((dx) => [dx - 1.35, dx + 1.35]), usableX1 - 0.5];
  for (let i = 0; i < stops.length; i += 2) {
    const [a, b] = [stops[i], stops[i + 1]];
    if (b - a < 1) continue;
    sides(a, b, 1.95, 2.6, C.glass);
    sides(a, b, 3.0, 3.65, C.glass);
  }
  // cab: light-blue sides, blue front, windscreen and lights
  if (cab !== 'none') {
    const front = cab === 'front' ? bodyX0 : bodyX1;
    const dir = cab === 'front' ? -1 : 1; // outward
    const inner = front - dir * cabLen;
    const [cx0, cx1] = cab === 'front' ? [front, inner] : [inner, front];
    sides(cx0, cx1, 1.1, 4.05, C.nose, SKIN * 1.5);
    sides(cx0 + (cab === 'front' ? 0.9 : 0.6), cx1 - (cab === 'front' ? 0.6 : 0.9), 2.5, 3.3, C.glass, SKIN * 2.5);
    const faceA = front + dir * 0.0;
    const faceB = front + dir * 0.06;
    const [fx0, fx1] = faceA < faceB ? [faceA, faceB] : [faceB, faceA];
    box(fx0, fx1, 1.1, 4.0, -HALF + 0.05, HALF - 0.05, C.blue);
    const [gx0, gx1] = dir < 0 ? [fx0 - 0.03, fx0] : [fx1, fx1 + 0.03];
    box(gx0, gx1, 2.55, 3.6, -HALF + 0.25, HALF - 0.25, C.glass);
    for (const z of [-0.95, 0.95]) {
      box(gx0, gx1, 1.55, 1.75, z - 0.25, z, C.light);
      box(gx0, gx1, 1.55, 1.75, z, z + 0.15, C.tail);
    }
  } else {
    // gangway halves at both ends
    box(bodyX0 - GAP / 2, bodyX0, 1.3, 3.7, -1.0, 1.0, C.gangway);
  }
  if (cab !== 'none') {
    const inner = cab === 'front' ? bodyX1 : bodyX0;
    box(Math.min(inner, inner + (cab === 'front' ? GAP / 2 : -GAP / 2)), Math.max(inner, inner + (cab === 'front' ? GAP / 2 : -GAP / 2)), 1.3, 3.7, -1.0, 1.0, C.gangway);
  } else {
    box(bodyX1, bodyX1 + GAP / 2, 1.3, 3.7, -1.0, 1.0, C.gangway);
  }
}

let x = -TOTAL / 2;
const cuts: number[] = [];
CARS.forEach((len, i) => {
  car(x, len, i === 0 ? 'front' : i === CARS.length - 1 ? 'rear' : 'none');
  x += len;
  if (i < CARS.length - 1) cuts.push(Number(x.toFixed(2)));
});

// --- GLB writer ---
const pos = new Float32Array(positions);
const col = new Uint8Array(colors);
const idx = new Uint32Array(indices);
const min = [0, 1, 2].map((k) => Math.min(...Array.from({ length: pos.length / 3 }, (_, i) => pos[i * 3 + k])));
const max = [0, 1, 2].map((k) => Math.max(...Array.from({ length: pos.length / 3 }, (_, i) => pos[i * 3 + k])));
const pad = (b: Buffer, fill = 0) => Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4, fill)]);
const parts = [Buffer.from(idx.buffer), Buffer.from(pos.buffer), Buffer.from(col.buffer)].map((b) => pad(b));
let offset = 0;
const bufferViews = parts.map((b, i) => {
  const v = { buffer: 0, byteOffset: offset, byteLength: b.length, target: i === 0 ? 34963 : 34962 };
  offset += b.length;
  return v;
});
const gltf = {
  asset: { version: '2.0', generator: 'paris-live-transport scripts/models/make-mi09.ts' },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ name: 'mi09', mesh: 0 }],
  meshes: [{ primitives: [{ attributes: { POSITION: 1, COLOR_0: 2 }, indices: 0, mode: 4 }] }],
  accessors: [
    { bufferView: 0, componentType: 5125, count: idx.length, type: 'SCALAR' },
    { bufferView: 1, componentType: 5126, count: pos.length / 3, type: 'VEC3', min, max },
    { bufferView: 2, componentType: 5121, normalized: true, count: col.length / 4, type: 'VEC4' },
  ],
  bufferViews,
  buffers: [{ byteLength: offset }],
};
const json = pad(Buffer.from(JSON.stringify(gltf)), 0x20);
const bin = Buffer.concat(parts);
const chunk = (type: number, data: Buffer) => {
  const h = Buffer.alloc(8);
  h.writeUInt32LE(data.length, 0);
  h.writeUInt32LE(type, 4);
  return Buffer.concat([h, data]);
};
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + json.length + 8 + bin.length, 8);
const out = path.resolve(__dirname, '../../public/models/mi09.glb');
writeFileSync(out, Buffer.concat([header, chunk(0x4e4f534a, json), chunk(0x004e4942, bin)]));
console.log(`${out}: ${idx.length / 3} triangles, length ${(max[0] - min[0]).toFixed(1)} m, cuts ${JSON.stringify(cuts)}`);
