/* Apply browser-local preferences before the first paint. */
(function () {
  'use strict';
  const root = document.documentElement;
  const palettes = {
    parchment: { name: 'Parchment', mode: 'light', color: '#eee9de' },
    evergreen: { name: 'Evergreen', mode: 'dark', color: '#182923' },
    midnight: { name: 'Night Shift', mode: 'dark', color: '#22272e' }
  };
  const read = key => { try { return localStorage.getItem(key); } catch { return null; } };
  const write = (key, value) => { try { localStorage.setItem(key, value); } catch { /* Session still works. */ } };
  let palette = read('nexus.palette');
  if (!Object.hasOwn(palettes, palette)) palette = read('nexus.theme') === 'dark' ? 'midnight' : 'parchment';
  let classic = read('nexus.gui') === 'classic';
  let motion = read('nexus.motion') === 'reduced' ? 'reduced' : 'full';
  let classicMode = read('nexus.theme') === 'light' ? 'light' : 'dark';
  function apply() {
    root.dataset.gui = classic ? 'classic' : 'workstation';
    root.dataset.palette = palette;
    root.dataset.theme = classic ? classicMode : palettes[palette].mode;
    root.dataset.motion = motion;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = classic ? (classicMode === 'dark' ? '#14101f' : '#cfc9de') : palettes[palette].color;
    document.dispatchEvent(new CustomEvent('nexus:appearance'));
  }
  window.NexusAppearance = {
    palettes,
    get palette() { return palette; },
    get classic() { return classic; },
    get motion() { return motion; },
    setPalette(value) {
      if (!Object.hasOwn(palettes, value)) return;
      palette = value; classic = false;
      write('nexus.palette', palette); write('nexus.gui', 'workstation'); apply();
    },
    setClassic(value) { classic = !!value; write('nexus.gui', classic ? 'classic' : 'workstation'); apply(); },
    setMotion(value) { motion = value === 'reduced' ? 'reduced' : 'full'; write('nexus.motion', motion); apply(); },
    toggleClassicMode() { classicMode = classicMode === 'dark' ? 'light' : 'dark'; write('nexus.theme', classicMode); apply(); }
  };
  if (read('nexus.crt') === 'on') root.dataset.crt = 'on';
  apply();
})();
