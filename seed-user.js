#!/usr/bin/env node
/* Test helper: give a user a finished piece instantly, skipping the
   upload-then-process-by-hand loop.

   Usage:
     node seed-user.js <username> <name-of-piece> [path-to.glb]

   Example:
     node seed-user.js shawn "Moon Jar" models/Turtle.glb

   With no .glb path it picks the first model in models/. The piece is marked
   done immediately, so it is tradeable right away. */
const fs = require('fs');
const path = require('path');

const [, , rawUser, rawNote, rawGlb] = process.argv;

if (!rawUser) {
  console.error('Usage: node seed-user.js <username> <name-of-piece> [path-to.glb]');
  process.exit(1);
}

const user = String(rawUser).toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32);
if (!user) {
  console.error('Username must contain letters or numbers.');
  process.exit(1);
}
const note = rawNote || 'Test Piece';

const MODELS = path.join(__dirname, 'models');
let glb = rawGlb ? path.resolve(rawGlb) : null;
if (!glb) {
  const first = fs.readdirSync(MODELS).find((f) => /\.glb$/i.test(f));
  if (!first) {
    console.error('No .glb found in models/ — pass one explicitly.');
    process.exit(1);
  }
  glb = path.join(MODELS, first);
}
if (!fs.existsSync(glb)) {
  console.error('No such file: ' + glb);
  process.exit(1);
}

const id = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '-' + Math.random().toString(36).slice(2, 7);
const dir = path.join(__dirname, 'uploads', user, id);
fs.mkdirSync(dir, { recursive: true });

// A 1x1 grey PNG stands in for the reference photo.
const px = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);
fs.writeFileSync(path.join(dir, '01-front.png'), px);
fs.copyFileSync(glb, path.join(dir, 'model.glb'));
fs.writeFileSync(
  path.join(dir, 'meta.json'),
  JSON.stringify(
    {
      id,
      user,
      note,
      submitted: new Date().toISOString(),
      images: [{ file: '01-front.png', view: 'front', original: 'seed.png', bytes: px.length }],
    },
    null,
    2
  ) + '\n'
);
fs.writeFileSync(path.join(dir, 'STATUS.txt'), 'done\n');

console.log(`Seeded "${note}" for ${user}`);
console.log(`  ${path.relative(process.cwd(), dir)}`);
console.log(`  model: ${path.basename(glb)}`);
console.log(`\nSign in as "${user}" to see it.`);
