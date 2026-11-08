/* Apply browser-local appearance before the first paint.
 *
 * Three themes:
 *   modern       the default since 0.9 — graphite dark / daylight light, one accent
 *   workstation  the 0.3–0.8 look, three palettes
 *   classic      the original pixel CRT
 *
 * Modern is a refinement layer on the workstation geometry, so it sets
 * data-gui="workstation" (rounded corners, 1px borders, the shared component
 * rules) plus data-skin="modern", which modern.css keys every override from.
 *
 * Everything here is a per-browser preference and never reaches the server.
 * `window.NexusAppearance` is the only supported way to change it; each change
 * re-applies and fires `nexus:appearance`.
 */
(function () {
  'use strict';
  const root = document.documentElement;
  const palettes = {
    parchment: { name: 'Parchment', mode: 'light', color: '#eee9de' },
    evergreen: { name: 'Evergreen', mode: 'dark', color: '#182923' },
    midnight: { name: 'Night Shift', mode: 'dark', color: '#22272e' }
  };
  const accents = {
    indigo: { name: 'Indigo', swatch: '#7c83ff' },
    blue: { name: 'Blue', swatch: '#4c9dff' },
    teal: { name: 'Teal', swatch: '#2ec4b6' },
    emerald: { name: 'Emerald', swatch: '#34c77b' },
    amber: { name: 'Amber', swatch: '#f0a52c' },
    rose: { name: 'Rose', swatch: '#f0567a' }
  };
  const skins = {
    modern: { name: 'Modern' },
    workstation: { name: 'Workstation' },
    classic: { name: 'Classic' }
  };
  const read = key => { try { return localStorage.getItem(key); } catch { return null; } };
  const write = (key, value) => { try { localStorage.setItem(key, value); } catch { /* Session still works. */ } };

  // A new key rather than the old `nexus.gui`: every browser that ever picked a
  // workstation palette stored "workstation" there, and reading it would keep
  // all of them off the new design after an upgrade.
  let skin = read('nexus.skin');
  if (!Object.hasOwn(skins, skin)) skin = 'modern';
  let palette = read('nexus.palette');
  if (!Object.hasOwn(palettes, palette)) palette = read('nexus.theme') === 'dark' ? 'midnight' : 'parchment';
  let mode = ['dark', 'light', 'system'].includes(read('nexus.mode')) ? read('nexus.mode') : 'dark';
  let accent = Object.hasOwn(accents, read('nexus.accent')) ? read('nexus.accent') : 'indigo';
  let glass = read('nexus.glass') !== 'off';
  let motion = read('nexus.motion') === 'reduced' ? 'reduced' : 'full';
  let classicMode = read('nexus.theme') === 'light' ? 'light' : 'dark';

  const sysDark = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;
  const modernMode = () => (mode === 'system' ? (sysDark && !sysDark.matches ? 'light' : 'dark') : mode);

  function apply() {
    let theme, color;
    if (skin === 'classic') {
      root.dataset.gui = 'classic';
      theme = classicMode;
      color = classicMode === 'dark' ? '#14101f' : '#cfc9de';
    } else if (skin === 'workstation') {
      root.dataset.gui = 'workstation';
      theme = palettes[palette].mode;
      color = palettes[palette].color;
    } else {
      root.dataset.gui = 'workstation';
      theme = modernMode();
      color = theme === 'dark' ? '#0b0c0f' : '#f6f7f9';
    }
    root.dataset.skin = skin;
    root.dataset.palette = skin === 'modern' ? (theme === 'dark' ? 'graphite' : 'daylight') : palette;
    root.dataset.theme = theme;
    root.dataset.accent = accent;
    root.dataset.glass = glass && skin !== 'classic' ? 'on' : 'off';
    root.dataset.motion = motion;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = color;
    document.dispatchEvent(new CustomEvent('nexus:appearance'));
  }

  sysDark?.addEventListener?.('change', () => { if (skin === 'modern' && mode === 'system') apply(); });

  window.NexusAppearance = {
    palettes, accents, skins,
    get skin() { return skin; },
    get palette() { return palette; },
    get mode() { return mode; },
    get accent() { return accent; },
    get glass() { return glass; },
    get motion() { return motion; },
    /** True for the pixel theme. Kept because older code asks this question. */
    get classic() { return skin === 'classic'; },
    setSkin(value) {
      if (!Object.hasOwn(skins, value)) return;
      skin = value; write('nexus.skin', skin); apply();
    },
    setMode(value) {
      if (!['dark', 'light', 'system'].includes(value)) return;
      mode = value; write('nexus.mode', mode);
      if (skin !== 'modern') { skin = 'modern'; write('nexus.skin', skin); }
      apply();
    },
    /** Flip between dark and light in whichever theme is active. */
    toggleMode() {
      if (skin === 'classic') return this.toggleClassicMode();
      if (skin === 'workstation') return this.setPalette(palettes[palette].mode === 'dark' ? 'parchment' : 'midnight');
      this.setMode(modernMode() === 'dark' ? 'light' : 'dark');
    },
    setAccent(value) {
      if (!Object.hasOwn(accents, value)) return;
      accent = value; write('nexus.accent', accent); apply();
    },
    setGlass(value) { glass = !!value; write('nexus.glass', glass ? 'on' : 'off'); apply(); },
    setPalette(value) {
      if (!Object.hasOwn(palettes, value)) return;
      palette = value; skin = 'workstation';
      write('nexus.palette', palette); write('nexus.skin', skin); apply();
    },
    setClassic(value) { skin = value ? 'classic' : 'modern'; write('nexus.skin', skin); apply(); },
    setMotion(value) { motion = value === 'reduced' ? 'reduced' : 'full'; write('nexus.motion', motion); apply(); },
    toggleClassicMode() { classicMode = classicMode === 'dark' ? 'light' : 'dark'; write('nexus.theme', classicMode); apply(); }
  };
  if (read('nexus.crt') === 'on') root.dataset.crt = 'on';
  apply();
})();
