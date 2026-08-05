# Models folder

Drop your `.glb` files in **this folder**, then refresh the manifest:

```
node build-manifest.js
```

(run it from the `site/` folder, one level up)

They'll show up on the site under **"From the Shelf"** in the left rail.

## Notes

- **Single-file `.glb` works best** — it carries its own textures. A `.gltf` that
  references external texture files will load, but it arrives untextured unless
  those files sit alongside it.
- Filenames become display names: `moon_jar.glb` → "Moon Jar". Files named as a
  bare UUID or hex blob get numbered instead — "Piece 01", "Piece 02" — since
  the filename says nothing useful.
- **To title a piece properly**, either rename the `.glb` before building, or
  edit the `name` field in `manifest.json`. Hand-edited names are preserved
  across later `build-manifest.js` runs, so you won't lose them.
- Models are auto-scaled and centred on the wheel, so size in your modelling
  app doesn't matter.
- Animated models play automatically.
- The site must be served over **http://**, not opened as a `file://` path —
  browsers block `fetch` on local files. See the main README for the one-liner.
