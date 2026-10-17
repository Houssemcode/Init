// Tests for the app-list cache (src/lib/appcache.ts).   Run: npm test
import {build} from 'esbuild';
const out = new URL('../node_modules/.cache-appcache-test.mjs', import.meta.url).pathname;
await build({entryPoints: [new URL('../src/lib/appcache.ts', import.meta.url).pathname], bundle: true, format: 'esm', outfile: out, platform: 'node', logLevel: 'error'});
const c = await import(out);
let fail = 0;
const eq = (a, b, m) => { const ok = JSON.stringify(a) === JSON.stringify(b); if (!ok) { fail++; console.log('FAIL', m, JSON.stringify(a), '!=', JSON.stringify(b)); } else console.log('ok  ', m); };

const apps = [
  {id: 'a.one', title: 'One', iconUrl: 'data:image/png;base64,AAAA', iconPath: '/media/icons/one.png'},
  {id: 'a.two', title: 'Two', iconUrl: 'assets/icons/two.png', color: '#123456'},
  {id: 'a.three', title: 'Three'}
];
const json = c.serializeApps(apps);
eq(json.includes('base64'), false, 'icon data is not stored twice');
const back = c.deserializeApps(json, (p) => (p === '/media/icons/one.png' ? 'data:image/png;base64,AAAA' : undefined));
eq(back, apps.map((a) => ({id: a.id, title: a.title, color: a.color, iconPath: a.iconPath, iconUrl: a.iconUrl})), 'the list comes back with its icons');
eq(c.deserializeApps(json, () => undefined)[0].iconUrl, undefined, 'a missing icon cache entry gives a monogram, not an error');
eq(c.deserializeApps(null, () => undefined), [], 'nothing cached -> empty list');
eq(c.deserializeApps('{broken', () => undefined), [], 'corrupt cache -> empty list');
eq(c.deserializeApps('{"a":1}', () => undefined), [], 'wrong shape -> empty list');
eq(c.deserializeApps('[{"id":1},{"id":"ok","title":"Ok"}]', () => undefined).map((a) => a.id), ['ok'], 'bad entries are dropped');
eq(c.sameApps(back, back.map((a) => ({...a}))), true, 'identical lists are the same');
eq(c.sameApps(back, back.slice(1)), false, 'different length differs');
eq(c.sameApps(back, back.map((a, i) => (i === 1 ? {...a, title: 'Changed'} : a))), false, 'a changed title differs');
process.exit(fail ? 1 : 0);
