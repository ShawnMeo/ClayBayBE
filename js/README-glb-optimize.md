# js/glb-optimize.js

A browser bundle of the glTF-Transform optimize pipeline, used by the admin
page to shrink a model **before** it is uploaded. Same passes as the CLI:

    dedup → resample → prune → sparse → weld → simplify → quantize

Typical result on a raw photogrammetry/AI export: **1.6 MB → 71 KB (96%)**,
in well under a second. Doing it client-side means a large raw export never
has to fit through the serverless request limit.

## Regenerating

It is vendored (no CDN, matching the rest of the site). To rebuild:

```sh
npm i @gltf-transform/core @gltf-transform/functions @gltf-transform/extensions meshoptimizer
printf 'export default {};\n' > empty.js

cat > entry.mjs <<'JS'
import { WebIO } from '@gltf-transform/core';
import { KHRONOS_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld, simplify, quantize, resample, sparse } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';

export async function optimizeGlb(arrayBuffer, opts = {}) {
  const io = new WebIO().registerExtensions(KHRONOS_EXTENSIONS);
  const doc = await io.readBinary(new Uint8Array(arrayBuffer));
  await MeshoptSimplifier.ready;
  await doc.transform(
    dedup(), resample(), prune(), sparse(), weld(),
    simplify({ simplifier: MeshoptSimplifier, error: opts.error ?? 0.001 }),
    quantize()
  );
  return (await io.writeBinary(doc)).buffer;
}
JS

npx esbuild entry.mjs --bundle --format=esm --minify \
  --outfile=js/glb-optimize.js --platform=browser \
  --alias:node:fs=./empty.js --alias:node:path=./empty.js
```

The two aliases are needed because `@gltf-transform/core` also ships NodeIO,
which imports `node:fs`. We only use `WebIO`, so stubbing them is safe.

`KHR_mesh_quantization` (what `quantize()` emits) is core three.js — no
external decoder, unlike Draco.
