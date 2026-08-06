/* Light / dark toggle.

   The palette already exists as CSS custom properties under
   :root[data-theme="dark"], so switching is one attribute. The site
   deliberately does NOT follow prefers-color-scheme — that used to make the
   page render brown on a dark-mode machine — so dark is opt-in and sticky.

   Applied before first paint (see the inline snippet in index.html) to avoid
   a white flash for people who chose dark. */
(() => {
  const KEY = 'claybay.theme';
  const root = document.documentElement;

  const apply = (theme) => {
    root.dataset.theme = theme;
    const dark = theme === 'dark';
    const btn = document.getElementById('theme-toggle');
    if (btn) {
      btn.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
      btn.setAttribute('title', dark ? 'Light mode' : 'Dark mode');
      const moon = document.getElementById('ic-moon');
      const sun = document.getElementById('ic-sun');
      // Show the mode you'd switch *to*, matching the view-cycle button.
      if (moon) moon.style.display = dark ? 'none' : '';
      if (sun) sun.style.display = dark ? '' : 'none';
    }
    // The 3D scene reads data-theme and relights itself via a MutationObserver
    // already wired into the viewer bundle, so nothing else to do here.
  };

  const current = () => (root.dataset.theme === 'dark' ? 'dark' : 'light');

  const set = (theme) => {
    apply(theme);
    try {
      localStorage.setItem(KEY, theme);
    } catch {}
  };

  const start = () => {
    let saved = null;
    try {
      saved = localStorage.getItem(KEY);
    } catch {}
    apply(saved === 'dark' ? 'dark' : 'light');
    const btn = document.getElementById('theme-toggle');
    if (btn) btn.addEventListener('click', () => set(current() === 'dark' ? 'light' : 'dark'));
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
