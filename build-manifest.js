#!/usr/bin/env node
/* Scans models/ for .glb/.gltf files and writes models/manifest.json.
   Run this after adding or removing models:  node build-manifest.js  */
const fs = require('fs');
const path = require('path');

const MODELS_DIR = path.join(__dirname, 'models');
const OUT = path.join(MODELS_DIR, 'manifest.json');

// A bare UUID / long hex blob makes a useless label, so number those instead.
const isOpaque = (stem) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(stem) ||
  /^[0-9a-f]{16,}$/i.test(stem);

const pretty = (file) => {
  const stem = file.replace(/\.(glb|gltf)$/i, '');
  if (isOpaque(stem)) return null; // caller numbers it
  return stem
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
};

if (!fs.existsSync(MODELS_DIR)) {
  fs.mkdirSync(MODELS_DIR, { recursive: true });
}

// Keep names you've hand-edited in the manifest instead of clobbering them.
let previous = {};
try {
  const old = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  for (const m of old.models || []) if (m.file) previous[m.file] = m.name;
} catch {}

let untitled = 0;
const models = fs
  .readdirSync(MODELS_DIR)
  .filter((f) => /\.(glb|gltf)$/i.test(f))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  .map((file) => {
    const auto = pretty(file);
    const name = previous[file] || auto || `Piece ${String(++untitled).padStart(2, '0')}`;
    const entry = { file, name, size: fs.statSync(path.join(MODELS_DIR, file)).size };
    // Gallery mode uses models/thumbs/<same-name>.png when one exists.
    const thumb = file.replace(/\.(glb|gltf)$/i, '') + '.png';
    if (fs.existsSync(path.join(MODELS_DIR, 'thumbs', thumb))) entry.thumb = 'thumbs/' + thumb;
    return entry;
  });

fs.writeFileSync(OUT, JSON.stringify({ models }, null, 2) + '\n');

if (!models.length) {
  console.log('No .glb/.gltf files found in models/ — wrote an empty manifest.');
} else {
  console.log(`Wrote ${path.relative(process.cwd(), OUT)} with ${models.length} model(s):`);
  for (const m of models) {
    const kb = m.size > 1048576 ? (m.size / 1048576).toFixed(1) + ' MB' : Math.round(m.size / 1024) + ' KB';
    console.log(`  · ${m.name}  (${m.file}, ${kb})`);
  }
}
