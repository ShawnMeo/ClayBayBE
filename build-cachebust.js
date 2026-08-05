#!/usr/bin/env node
/* Stamp every css/js reference in index.html with a hash of that file's contents.

   Assets are served with `immutable, max-age=1 year` for speed, which means a
   browser that has seen styles.css will not re-check it — phones especially
   will keep showing the old design after a deploy. Appending ?v=<hash> gives
   a changed file a new URL, so it is fetched, while unchanged files keep
   their cached copy.

   Runs automatically as part of the Netlify build. Safe to run repeatedly:
   existing ?v= stamps are replaced, not stacked. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const HTML = path.join(ROOT, 'index.html');

const hashOf = (rel) => {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) return null;
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 8);
};

let html = fs.readFileSync(HTML, 'utf8');
let changed = 0;

html = html.replace(/(href|src)="((?:css|js)\/[^"?]+)(\?v=[a-f0-9]+)?"/g, (full, attr, rel) => {
  const h = hashOf(rel);
  if (!h) {
    console.warn(`! missing ${rel} — left unstamped`);
    return full;
  }
  changed++;
  return `${attr}="${rel}?v=${h}"`;
});

fs.writeFileSync(HTML, html);
console.log(`Stamped ${changed} asset reference(s) in index.html`);
