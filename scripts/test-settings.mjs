// Tests for the settings model (src/lib/storage.ts, src/lib/prefs.ts).   Run: npm test
import {build} from 'esbuild';

const out = new URL('../node_modules/.cache-settings-test.mjs', import.meta.url).pathname;
await build({
  entryPoints: [new URL('../src/lib/prefs.ts', import.meta.url).pathname], bundle: true, format: 'esm', outfile: out, platform: 'node', logLevel: 'error',
  plugins: [{name: 'stub-apps', setup(b) {
    b.onResolve({filter: /\.\/apps$/}, () => ({path: 'apps-stub', namespace: 'stub'}));
    b.onLoad({filter: /.*/, namespace: 'stub'}, () => ({contents: 'export const exec = () => Promise.resolve(""); export const shellQuote = (v) => v;', loader: 'js'}));
  }}]
});
const storage = await build({entryPoints: [new URL('../src/lib/storage.ts', import.meta.url).pathname], bundle: true, format: 'esm', write: false, platform: 'node', logLevel: 'error'});
const storageOut = new URL('../node_modules/.cache-storage-test.mjs', import.meta.url).pathname;
(await import('fs')).writeFileSync(storageOut, storage.outputFiles[0].text);

// a tiny localStorage for loadConfig
const store = {};
globalThis.localStorage = {getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }};

const winOut = new URL('../node_modules/.cache-optionwindow-test.mjs', import.meta.url).pathname;
await build({entryPoints: [new URL('../src/lib/optionwindow.ts', import.meta.url).pathname], bundle: true, format: 'esm', outfile: winOut, platform: 'node', logLevel: 'error'});
const ow = await import(winOut);
const p = await import(out);
const s = await import(storageOut);
let fail = 0;
const eq = (a, b, m) => { const ok = JSON.stringify(a) === JSON.stringify(b); if (!ok) { fail++; console.log('FAIL', m, JSON.stringify(a), '!=', JSON.stringify(b)); } else console.log('ok  ', m); };
const KEY = 'customlauncher-config-v1';

// ---- defaults and loading ----
const d = s.loadConfig();
eq([d.theme, d.iconScale, d.sideMargin, d.bottomMargin, d.clockFormat, d.clock.size, d.clock.weight, d.clock.top, d.clock.left], ['black', 100, 50, 40, '12h', 140, 200, 28, 50], 'defaults: OLED black, 12-hour, tighter margins, smaller clock');
store[KEY] = JSON.stringify({theme: 'grey', iconScale: 999, sideMargin: 33, bottomMargin: -5, clock: {size: 12, top: 29, weight: 999, color: 'neon', showDate: false}, wallpaper: {mode: 'folder', path: '/x', intervalSec: 2}});
const g = s.loadConfig();
eq([g.theme, g.iconScale, g.sideMargin, g.bottomMargin], ['grey', 140, 30, 0], 'out-of-range numbers are clamped and snapped');
eq([g.clock.size, g.clock.top, g.clock.weight, g.clock.color, g.clock.showDate, g.clock.showPeriod], [80, 30, 200, 'white', false, true], 'clock values validated, missing ones default');
eq([g.wallpaper.mode, g.wallpaper.intervalSec], ['folder', 60], 'bad interval falls back');
store[KEY] = '{not json';
eq(s.loadConfig().theme, 'black', 'corrupt storage falls back to defaults');
store[KEY] = JSON.stringify({wallpaper: {mode: 'folder', path: ''}});
eq(s.loadConfig().wallpaper.mode, 'gradient', 'folder mode without a path becomes default background');

// ---- stepping ----
eq(s.stepValue([1, 2, 3], 3, 1, true), 1, 'OK wraps round');
eq(s.stepValue([1, 2, 3], 3, 1, false), 3, 'arrow stops at the end');
eq(s.stepValue([1, 2, 3], 1, -1, false), 1, 'arrow stops at the start');
eq(s.stepValue([1, 2, 3], 99, 1, true), 2, 'unknown value starts from the first');

// ---- prefs ----
const c0 = s.DEFAULT_CONFIG;
eq(p.applyPref(c0, 'iconScale', 'right').iconScale, 110, 'right arrow: icon size 100 -> 110');
eq(p.applyPref(c0, 'iconScale', 'left').iconScale, 90, 'left arrow: icon size 100 -> 90');
eq(p.applyPref({...c0, iconScale: 140}, 'iconScale', 'right').iconScale, 140, 'right arrow stops at the maximum');
eq(p.applyPref({...c0, iconScale: 140}, 'iconScale', 'ok').iconScale, 70, 'OK wraps to the minimum');
eq(p.applyPref(c0, 'theme', 'ok').theme, 'grey', 'OK flips the theme');
eq(p.applyPref(c0, 'showDate', 'ok').clock.showDate, false, 'OK flips a switch');
eq(p.applyPref(c0, 'showDate', 'right') === c0, true, 'arrows leave a switch alone');
eq(p.applyPref(c0, 'clockSize', 'right').clock.size, 150, 'clock size steps by 10');
eq(p.applyPref(c0, 'clockTop', 'right').clock.top, 30, 'clock height steps by 2%');
eq(p.applyPref(c0, 'clockLeft', 'left').clock.left, 48, 'clock sideways: left arrow moves it left by 2%');
eq(p.applyPref({...c0, clock: {...c0.clock, left: 100}}, 'clockLeft', 'right').clock.left, 100, 'clock sideways stops at the right limit');
eq(p.applyPref({...c0, clock: {...c0.clock, left: 0}}, 'clockLeft', 'left').clock.left, 0, 'clock sideways stops at the left limit');
eq(p.applyPref(c0, 'clockWeight', 'ok').clock.weight, 300, 'thickness: thin -> light');
eq(p.applyPref(c0, 'wallpaper', 'ok') === c0, true, 'the wallpaper row is an action, not a value');
eq(p.applyPref(c0, 'nonsense', 'ok') === c0, true, 'unknown option does nothing');
eq(s.loadConfig().clock.left, 50, 'missing clock position defaults to the centre');
const messy = {...c0, theme: 'grey', iconScale: 70, sideMargin: 0, bottomMargin: 200, clockFormat: '24h', clock: {...c0.clock, size: 220, color: 'amber'}, appIds: ['a'], wallpaper: {...c0.wallpaper, mode: 'image', path: '/p.jpg'}};
const r = p.resetLook(messy);
eq([r.theme, r.iconScale, r.sideMargin, r.bottomMargin, r.clockFormat, r.clock.size, r.clock.color], ['black', 100, 50, 40, '12h', 140, 'white'], 'reset restores the look and clock');
eq([r.appIds, r.wallpaper.mode], [['a'], 'image'], 'reset keeps apps and wallpaper');

// ---- the lists shown in Settings ----
for (const tab of ['look', 'clock', 'wallpaper', 'options']) {
  const list = p.optionsFor(tab, c0);
  eq(list.length >= 1 && list.length <= 12, true, `${tab} tab has ${list.length} options (a long list scrolls)`);
}
const look = p.optionsFor('look', c0);
eq(look.map((o) => o.valueText), ['OLED black', '100%', '50 px', '40 px'], 'Look tab shows current values');
const optsOn = p.optionsFor('options', c0, {homeApp: 'tld.my.customlauncher'});
const optsOff = p.optionsFor('options', c0, {homeApp: 'com.webos.app.home'});
const optsUnknown = p.optionsFor('options', c0, {homeApp: null});
eq([optsOn, optsOff, optsUnknown].map((o) => o.find((x) => x.id === 'useAsHome').valueText), ['On', 'Off', 'Unknown'], 'home-app row shows On / Off / Unknown');
eq(p.optionsFor('options', c0).map((o) => o.id).join(','), 'useHomebrew,replaceHome,startAtBoot,useAsHome,closeHome,closeHomeNow,resetLook', 'the Options tab is in the requested order');
eq(p.optionsFor('options', c0)[1].label, 'Make this launcher the default instead of LG Home', 'the default-home helper has its new name');
eq(p.optionsFor('clock', c0).filter((o) => /Clock position/.test(o.label)).map((o) => o.label).join(' | '), 'Clock position (vertical) | Clock position (horizontal)', 'the clock position settings are named vertical and horizontal');
eq(JSON.stringify([p.applyPref({...c0, clock: {...c0.clock, top: 2}}, 'clockTop', 'left').clock.top, p.applyPref({...c0, clock: {...c0.clock, top: 0}}, 'clockTop', 'left').clock.top]), '[0,0]', 'the clock can go all the way to the top (0%) and stops there');
eq([p.applyPref({...c0, clock: {...c0.clock, left: 100}}, 'clockLeft', 'right').clock.left, p.applyPref({...c0, clock: {...c0.clock, left: 0}}, 'clockLeft', 'left').clock.left], [100, 0], 'the horizontal position runs from 0% to 100%');
// ---- the scrolling window ----
const H = [128, 128, 128, 128, 128, 100, 100];                 // seven rows, taller than 800 px together
eq(ow.windowEnd(H, 0), 6, 'at the top, six of the seven rows fit');
eq(ow.windowStart(H, 6, 0), 1, 'moving down to the last row scrolls the list so it is visible');
eq(ow.windowEnd(H, 1), 7, 'and then the last row is shown');
eq(ow.windowStart(H, 5, 1), 1, 'moving up inside the window does not scroll');
eq(ow.windowStart(H, 0, 1), 0, 'moving above the window scrolls up');
eq(ow.windowStart(H, 0, 0), 0, 'and the top is the top');
eq(ow.windowStart([100, 100], 1, 0), 0, 'a short list never scrolls');
eq(ow.windowEnd([2000, 100], 0), 1, 'a single very tall row is still shown');
eq([ow.optionHeight('short'), ow.optionHeight('x'.repeat(100)), ow.optionHeight('x'.repeat(200))].join(','), '111,139,167', 'row height grows with the description length');
eq(p.applyPref({...c0, wallpaper: {...c0.wallpaper, intervalSec: 900}}, 'interval', 'ok').wallpaper.intervalSec, 1800, 'the slideshow interval goes 15 minutes -> 30 minutes');
eq(p.applyPref({...c0, wallpaper: {...c0.wallpaper, intervalSec: 1800}}, 'interval', 'ok').wallpaper.intervalSec, 3600, 'and 30 minutes -> 1 hour');
eq(p.intervalText(1800), '30 minutes', 'the 30-minute interval reads "30 minutes"');
eq(p.intervalText(60), '1 minute', 'interval text');
eq(p.intervalText(3600), '1 hour', 'interval text hour');
process.exit(fail ? 1 : 0);
