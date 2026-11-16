// Vérifie les invariants de public/data/network.json (Step 6 de la tâche 3).
// Usage : npm run check:data
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { Network } from '../lib/types';
import { checkNetwork } from '../lib/static/network-checks';

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'public/data/network.json');
const ET = path.join(ROOT, 'tests/fixtures/et-sample.json');

const net = JSON.parse(readFileSync(OUT, 'utf8')) as Network;
const checks = checkNetwork(net, statSync(OUT).size, JSON.parse(readFileSync(ET, 'utf8')));
for (const c of checks) console.log(`${c.ok ? 'OK  ' : 'FAIL'} ${c.label}`);
console.log(`generatedAt ${net.generatedAt} : ${net.patterns.length} patterns, ${Object.keys(net.stations).length} stations, ${Object.keys(net.quays).length} quais, ${Object.keys(net.segments).length} segments`);
if (checks.some((c) => !c.ok)) process.exit(1);
