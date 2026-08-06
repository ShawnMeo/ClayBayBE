/* Avatar marks — pottery-shaped SVG line drawings in a few glaze colours.

   Drawn rather than downloaded: they scale crisply at 26px in the rail and at
   80px in the picker, cost nothing to fetch, and match the line-work of the
   ClayBay logo. An avatar is stored as "<shape>.<colour>", e.g. "jar.glaze".

   window.__AVATARS__ is the single source both the account card and the
   picker read from, so a new shape only has to be added here. */
(() => {
  // 24x24 viewBox, stroked not filled, so one path works at any size.
  const SHAPES = {
    jar: {
      name: 'Moon jar',
      d: 'M9.2 3 h5.6 M10 3 C10.2 4.6 9.6 5.6 8.2 6.6 C5.6 8.4 5.4 14.6 8.4 17 C10.5 18.8 13.5 18.8 15.6 17 C18.6 14.6 18.4 8.4 15.8 6.6 C14.4 5.6 13.8 4.6 14 3 M7 20.5 h10',
    },
    bowl: {
      name: 'Bowl',
      d: 'M3.5 9.5 h17 M4.5 9.5 C5 15.5 8 19 12 19 C16 19 19 15.5 19.5 9.5 M8 13 C9 15 10.4 16.2 12 16.5',
    },
    teapot: {
      name: 'Teapot',
      d: 'M5 11 h11 a3.2 3.2 0 0 1 0 0 C16 15.6 13.8 18.5 10.5 18.5 C7.2 18.5 5 15.6 5 11 Z M16 12 C19 12 20.5 13.5 20.5 15 M8 11 C8 8.6 9.1 7.4 10.5 7.4 C11.9 7.4 13 8.6 13 11 M10.5 7.4 V5.6 M3 18.5 h15',
    },
    vase: {
      name: 'Vase',
      d: 'M9.5 3.5 h5 M10 3.5 C10 6 8.5 7 8.5 9.5 C8.5 12 7 13 7 16 C7 18.8 9.2 20.5 12 20.5 C14.8 20.5 17 18.8 17 16 C17 13 15.5 12 15.5 9.5 C15.5 7 14 6 14 3.5',
    },
    kiln: {
      name: 'Kiln',
      d: 'M4.5 20 V10.5 C4.5 6.9 7.9 4 12 4 C16.1 4 19.5 6.9 19.5 10.5 V20 Z M9 20 v-5.5 h6 V20 M8 9 h8',
    },
    wheel: {
      name: 'Wheel',
      d: 'M12 4.5 a7.5 7.5 0 1 0 0.01 0 Z M12 9 a3 3 0 1 0 0.01 0 Z M12 4.5 V9 M12 15 v4.5 M4.5 12 H9 M15 12 h4.5',
    },
  };

  // Glaze names borrowed from the palette already in the CSS.
  const COLOURS = {
    glaze: { name: 'Cobalt', ink: '#37527A', wash: '#E8EDF6' },
    clay: { name: 'Terracotta', ink: '#B4643F', wash: '#F7EAE3' },
    celadon: { name: 'Celadon', ink: '#4F7A63', wash: '#E7F0EA' },
    ash: { name: 'Ash', ink: '#5B6470', wash: '#ECEEF1' },
    iron: { name: 'Iron', ink: '#6B4A2F', wash: '#F1E9E1' },
    plum: { name: 'Plum', ink: '#6E4668', wash: '#F2EAF1' },
  };

  const DEFAULT = 'jar.glaze';

  const parse = (id) => {
    const [shape, colour] = String(id || '').split('.');
    return {
      shape: SHAPES[shape] ? shape : 'jar',
      colour: COLOURS[colour] ? colour : 'glaze',
    };
  };

  /* Inline SVG for an avatar id. `size` is a CSS length. */
  const svg = (id, size) => {
    const { shape, colour } = parse(id);
    const c = COLOURS[colour];
    const s = size || '100%';
    return `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none"
      stroke="${c.ink}" stroke-width="1.4" stroke-linecap="round"
      stroke-linejoin="round" aria-hidden="true"
      style="background:${c.wash}"><path d="${SHAPES[shape].d}"/></svg>`;
  };

  /* A stable avatar for someone who has not chosen one, derived from their
     name so it is at least consistent rather than random. */
  const forName = (name) => {
    const keys = Object.keys(SHAPES);
    const cols = Object.keys(COLOURS);
    let h = 0;
    for (const ch of String(name || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return `${keys[h % keys.length]}.${cols[Math.floor(h / keys.length) % cols.length]}`;
  };

  const all = () => {
    const out = [];
    for (const shape of Object.keys(SHAPES))
      for (const colour of Object.keys(COLOURS))
        out.push({ id: `${shape}.${colour}`, label: `${SHAPES[shape].name} · ${COLOURS[colour].name}` });
    return out;
  };

  window.__AVATARS__ = { svg, forName, all, parse, DEFAULT, SHAPES, COLOURS };
})();
