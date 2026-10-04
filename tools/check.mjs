#!/usr/bin/env node
/**
 * Everything that must be true before a trip ships. No dependencies:
 *
 *   node tools/check.mjs
 *
 * Every failure names the file, the event and what is wrong, so whoever is editing —
 * a person or an agent — can fix the data and run it again. Fix the data, never the check.
 *
 * The trip is validated against trip.schema.json, then against what a schema can't say.
 * The app is checked too: Node can't run app.js (no DOM), so its calls are checked
 * statically — a refactor once deleted helpers that were still called, the page still
 * rendered, and every tap was silently dead.
 */
import { readFileSync, existsSync, readdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Paths below are from the repo root, wherever this is run from.
process.chdir(fileURLToPath(new URL('..', import.meta.url)));

const src = readFileSync('public/app.js', 'utf8');
// Prose must not be scanned for calls: "with the app installed (the app…)" reads as a
// call to `installed`. Block comments go wholesale; line comments only when `//` follows
// whitespace, so a `https://…` inside a string survives.
const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|\s)\/\/[^\n]*/g, '$1');
const fail = [];
const ok = [];

// 0. Everything parses. A syntax error ships a blank page (app.js, or the JSON it
//    fetches) or a worker that can never install, so no phone would ever update again
//    (sw.js). app.js is checked through an .mjs copy, so it is parsed as a module
//    however this Node version treats a plain .js file.
const broken = [];
const tmp = mkdtempSync(join(tmpdir(), 'trip-check-'));
try {
  for (const file of ['public/app.js', 'public/sw.js']) {
    let target = file;
    if (file === 'public/app.js') {
      target = join(tmp, 'app.mjs');
      writeFileSync(target, readFileSync(file));
    }
    const r = spawnSync(process.execPath, ['--check', target], { encoding: 'utf8' });
    if (r.status === 0) continue;
    const line = r.stderr.match(/:(\d+)\r?\n/)?.[1];
    const why = r.stderr.split('\n').find((l) => /^\w*Error\b/.test(l)) ?? r.stderr.trim();
    broken.push(`${file}${line ? `:${line}` : ''} ${why}`);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
const json = (path) => {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch (e) { broken.push(`${path} ${e.message}`); return null; }
};
const trip = json('public/data/trip.json');
const schema = json('trip.schema.json');
const forecast = existsSync('public/data/forecast.json') ? json('public/data/forecast.json') : null;
broken.length ? fail.push(`does not parse: ${broken.join('; ')}`)
              : ok.push('app.js, sw.js, trip.json, trip.schema.json and forecast.json all parse');

// 1. Every top-level const/function is defined before it is used, and every
//    identifier that looks like one of ours actually exists.
const defined = new Set([...src.matchAll(/^(?:export\s+)?(?:async\s+)?(?:const|let|function)\s+([A-Za-z_$][\w$]*)/gm)].map(m => m[1]));
const declaredInline = new Set([...src.matchAll(/(?:const|let|var|function)\s+([A-Za-z_$][\w$]*)/g)].map(m => m[1]));
// params and destructured locals
for (const m of src.matchAll(/\(([^)]*)\)\s*=>/g))
  for (const part of m[1].split(',')) { const n = part.trim().replace(/[{}[\]].*/, '').split(/[=:\s]/)[0]; if (n) declaredInline.add(n); }

// Bare calls only. Excludes `.foo(` (methods) and `\b(` (regex word boundaries).
const called = new Set([...code.matchAll(/(?<![.\\\w$'"`])([a-z][A-Za-z0-9_$]*)\s*\(/g)].map(m => m[1]));
// Language keywords and platform globals only. Never one of app.js's own names — listing
// `copy` here once meant deleting copy() would have passed this check.
const BUILTIN = new Set(['if','for','while','switch','catch','return','typeof','function','await','fetch',
  'setTimeout','setInterval','clearInterval','requestAnimationFrame','addEventListener','encodeURIComponent',
  'decodeURIComponent','parseInt','parseFloat','isNaN','test','match','replace','split','join','filter','map',
  'find','forEach','push','append','querySelector','querySelectorAll','getElementById','toggle','add','remove',
  'contains','close','showModal','format','round','max','min','floor','abs','then','finally',
  'reject','all','keys','values','entries','from','of','stringify','parse','padStart','slice','indexOf','trim',
  'createElement','createRange','selectNodeContents','removeAllRanges','addRange','getSelection','observe',
  'unregister','release','request','writeText','execCommand','select','startsWith','endsWith','includes',
  'toLowerCase','toUpperCase','setProperty','getPropertyValue','getBoundingClientRect','scrollTo','decode',
  'confirm','alert','var','get','set','in','new','delete','void','do','else','try','String','Number','Boolean','Date','Math','JSON','Object','Array','Set','Map','URL',
  'URLSearchParams','Intl','Promise','Request','Response','sort','reduce','some','every','concat','toggleAttribute',
  'matchMedia','getItem','setItem','prompt']);

const unknown = [...called].filter(n => !defined.has(n) && !declaredInline.has(n) && !BUILTIN.has(n));
unknown.length ? fail.push(`called but never defined: ${unknown.join(', ')}`)
               : ok.push(`all ${called.size} called identifiers resolve`);

// The trip's own files, exactly as sw.js's tripAssets() collects them.
const events = trip?.days?.flatMap((d) => d.events ?? []) ?? [];
const tripFiles = [...new Set(events.flatMap((e) => [
  e.image?.src, ...(e.qr ?? []).map((q) => q.src), ...(e.files ?? []).map((f) => f.src),
]).filter(Boolean))];

// 3. The precache is the whole app. Everything under public/ ships and offline is the
//    point, so every file must be precached — a QR code left out renders fine online
//    and is blank at the gate. The app's own files are ASSETS in sw.js; the trip's are
//    whatever trip.json names. The shell is './', never 'index.html': cleanUrls
//    redirects every *.html, and a redirected response cannot answer a navigation.
const sw = readFileSync('public/sw.js', 'utf8');
const assetBlock = (sw.match(/const ASSETS = \[([\s\S]*?)\];/)?.[1] ?? '').replace(/\/\/[^\n]*/g, '');
const assets = [...assetBlock.matchAll(/'([^']+)'/g)].map(m => m[1]);
const precached = [...assets, ...tripFiles];
const walk = (dir) => readdirSync(dir, { withFileTypes: true })
  .filter((d) => !d.name.startsWith('.'))
  .flatMap((d) => (d.isDirectory() ? walk(`${dir}/${d.name}`) : [`${dir}/${d.name}`]));
const shipped = walk('public').map((f) => f.slice('public/'.length));
const precache = [];
if (!assets.includes('./')) precache.push("the shell './' is not precached");
const html = precached.filter((a) => a.endsWith('.html'));
if (html.length) precache.push(`${html.join(', ')} redirects under cleanUrls — precache './' instead`);
const absent = precached.filter((a) => a !== './' && !existsSync(`public/${a}`));
if (absent.length) precache.push(`precached or named in trip.json but missing on disk: ${absent.join(', ')}`);
const uncached = shipped.filter((f) => f !== 'sw.js' && f !== 'index.html' && !precached.includes(f));
const unusedTrip = uncached.filter((f) => f.startsWith('assets/trip/'));
const uncachedApp = uncached.filter((f) => !f.startsWith('assets/trip/'));
if (unusedTrip.length) precache.push(`nothing in trip.json uses ${unusedTrip.join(', ')} — delete it, or name it in an event's image, qr or files`);
if (uncachedApp.length) precache.push(`shipped but not in ASSETS in public/sw.js, so blank offline: ${uncachedApp.join(', ')}`);
precache.length ? fail.push(...precache)
                : ok.push(`all ${assets.length} app files and ${tripFiles.length} trip files exist and are precached, and nothing else ships`);

// 3b. The booking material stays private. bookings/ is where the user drops PDFs, emails
//     and screenshots for the agent to read; .gitignore keeps it out of git, and this
//     catches a forced add or a broken .gitignore before it is pushed.
const tracked = spawnSync('git', ['ls-files', 'bookings'], { encoding: 'utf8' });
if (tracked.status === 0) {
  const leaked = tracked.stdout.split('\n').filter((f) => f && f !== 'bookings/README.md');
  leaked.length ? fail.push(`bookings/ must never be committed, but git tracks: ${leaked.join(', ')} — run git rm --cached on them`)
                : ok.push('nothing in bookings/ is tracked by git');
}

// 4. trip.json against trip.schema.json — a small validator for the parts of JSON
//    Schema the file uses, so the schema stays the one description of the format.
function validate(v, s, path, errs) {
  if (s.$ref) s = s.$ref.slice(2).split('/').reduce((o, k) => o[k], schema);
  if (s.oneOf) {
    const fits = s.oneOf.filter((x) => { const e = []; validate(v, x, path, e); return !e.length; }).length;
    if (fits !== 1) errs.push(`${path}: is not one of the allowed shapes`);
    return;
  }
  if ('const' in s && v !== s.const) return errs.push(`${path}: must be ${JSON.stringify(s.const)}`);
  if (s.enum && !s.enum.includes(v)) return errs.push(`${path}: '${v}' is not one of ${s.enum.join(', ')}`);
  if (s.type) {
    const t = Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v;
    if (![].concat(s.type).includes(t)) return errs.push(`${path}: should be ${[].concat(s.type).join(' or ')}, is ${t}`);
  }
  if (typeof v === 'string') {
    if (s.minLength && v.length < s.minLength) errs.push(`${path}: is empty`);
    if (s.pattern && !new RegExp(s.pattern, 'u').test(v)) errs.push(`${path}: '${v}' does not match ${s.pattern}`);
  }
  if (Array.isArray(v)) {
    if (s.minItems != null && v.length < s.minItems) errs.push(`${path}: needs at least ${s.minItems}`);
    if (s.maxItems != null && v.length > s.maxItems) errs.push(`${path}: allows at most ${s.maxItems}`);
    if (s.items) v.forEach((x, i) => validate(x, s.items, `${path}[${i}]`, errs));
  } else if (v && typeof v === 'object') {
    for (const k of s.required ?? []) if (!(k in v)) errs.push(`${path}: missing "${k}"`);
    for (const [k, x] of Object.entries(v)) {
      if (s.properties?.[k]) validate(x, s.properties[k], `${path}.${k}`, errs);
      else if (s.additionalProperties === false) errs.push(`${path}: unknown field "${k}"`);
    }
  }
}
if (trip && schema) {
  const errs = [];
  validate(trip, schema, 'trip.json', errs);
  // Name events by id where they have one: "d2-c7768" beats "days[1].events[6]".
  const named = errs.map((m) => m.replace(/^trip\.json\.days\[(\d+)\]\.events\[(\d+)\]/, (all, d, i) =>
    trip.days[d]?.events?.[i]?.id ?? `day ${+d + 1}, event ${+i + 1}`));
  named.length ? fail.push(`trip.json does not fit trip.schema.json: ${named.slice(0, 15).join('; ')}${named.length > 15 ? ` (+${named.length - 15} more)` : ''}`)
               : ok.push(`trip.json fits trip.schema.json (${trip.days.length} days, ${events.length} events)`);
}

// 4b. What a schema can't say. Each of these fails silently in the app: an event out of
//     order or with a duplicate id breaks "now" and "up next", one filed under the wrong
//     day draws there, and an icon that isn't there is a broken image.
if (trip?.days) {
  const offset = trip.trip?.offset ?? '';
  const instant = (t) => Date.parse(/(z|[+-]\d\d:\d\d)$/i.test(t) ? t : `${t}${offset}`);
  const bad = [];
  const ids = new Set();
  let prev = null;
  trip.days.forEach((d, di) => {
    const prevDay = trip.days[di - 1];
    if (prevDay && !(d.date > prevDay.date)) bad.push(`day ${di + 1} (${d.date}) is not after ${prevDay.date}`);
    // An event belongs to its day, or to the small hours after it: a late check-in, a
    // midnight flight.
    const next = new Date(Date.parse(`${d.date}T12:00:00Z`) + 864e5).toISOString().slice(0, 10);
    (d.events ?? []).forEach((e, i) => {
      const id = e.id ?? `d${di + 1}-${i + 1}`;
      if (ids.has(id)) bad.push(`${id}: duplicate id`);
      ids.add(id);
      if (Number.isNaN(instant(e.start))) bad.push(`${id}: start '${e.start}' is not a time`);
      if (prev && instant(e.start) < instant(prev.e.start)) bad.push(`${id}: starts before ${prev.id} above it`);
      if (e.end && instant(e.end) < instant(e.start)) bad.push(`${id}: ends before it starts`);
      const date = String(e.start).slice(0, 10);
      if (date !== d.date && !(date === next && e.start.slice(11, 13) < '06')) bad.push(`${id}: starts ${date}, but it is filed under ${d.date}`);
      for (const l of e.links ?? []) {
        if (/^[a-z0-9-]+$/.test(l.icon) && !existsSync(`public/assets/icons/${l.icon}.svg`)) bad.push(`${id}: no icon '${l.icon}' in assets/icons`);
      }
      prev = { e, id };
    });
  });
  for (const l of trip.links ?? []) {
    if (/^[a-z0-9-]+$/.test(l.icon) && !existsSync(`public/assets/icons/${l.icon}.svg`)) bad.push(`links: no icon '${l.icon}' in assets/icons`);
  }
  if (forecast) {
    const dates = new Set(trip.days.map((d) => d.date));
    const stray = Object.keys(forecast.days ?? {}).filter((k) => !dates.has(k));
    if (stray.length) bad.push(`forecast.json has days the trip doesn't: ${stray.join(', ')} — re-run tools/forecast.mjs`);
  }
  bad.length ? fail.push(`trip data: ${bad.join('; ')}`)
             : ok.push('events unique, in time order, on their own day, and every icon exists');
}

// 4c. A shared trip carries nothing personal. The site is public, so "shared": true in
//     trip.json makes this check refuse what a traveller only needs at a gate: QR codes,
//     booking files, and anything that reads like a booking number, PIN, phone number or
//     email. Names can't be caught by a pattern — reading the page before sharing it
//     still matters.
if (trip?.trip?.shared) {
  const found = [];
  for (const e of events) {
    if (e.qr?.length) found.push(`${e.id ?? e.title}: QR codes`);
    if (e.files?.length) found.push(`${e.id ?? e.title}: booking files`);
  }
  const PERSONAL = [
    [/\+\d{1,3}[\s-]?\(?\d{2,4}\)?[\s-]?\d{3,4}[\s-]?\d{2,4}/, 'a phone number'],
    [/[\w.+-]+@[\w-]+\.[\w.-]+/, 'an email address'],
    [/\bPIN\b/, 'a PIN'],
    [/\b[A-Z]{1,4}\d{7,}\b|\d{10,}/, 'a booking or ID number'],
    [/\b(booking|order|confirmation|voucher|reservation|passport|ticket)\s*(no\.?|number|#|code)/i, 'a booking label'],
    [/^confirmation$/i, 'a booking label'],
  ];
  // Every string in the data except URLs, which carry ids that aren't anyone's.
  const strings = (v, path) => (typeof v === 'string' ? [[path, v]]
    : Array.isArray(v) ? v.flatMap((x, i) => strings(x, `${path}[${i}]`))
    : v && typeof v === 'object' ? Object.entries(v).filter(([k]) => k !== 'url' && k !== '$schema').flatMap(([k, x]) => strings(x, `${path}.${k}`))
    : []);
  const texts = strings(trip, 'trip.json');
  // Name events by id, as the schema errors do.
  const where = (path) => path.replace(/^trip\.json\.days\[(\d+)\]\.events\[(\d+)\]\.?/, (all, d, i) =>
    `${trip.days[d]?.events?.[i]?.id ?? `day ${+d + 1}, event ${+i + 1}`} `);
  for (const [path, text] of texts) {
    for (const [re, what] of PERSONAL) if (re.test(text)) found.push(`${where(path)} looks like ${what}: "${text.slice(0, 60)}"`);
  }
  found.length ? fail.push(`shared trip, but personal data: ${found.slice(0, 12).join('; ')}${found.length > 12 ? ` (+${found.length - 12} more)` : ''}`)
               : ok.push('shared trip: no QR codes, booking files, numbers, PINs, phones or emails');
}

// 4d. Installable. The trip is a PWA: Chrome and Edge only offer to install a page whose
//     manifest has a name, a start URL, standalone display and 192 and 512 px icons, and
//     whose service worker is registered. The home screen shows the manifest's names, so
//     they belong to the trip: name is the trip's title, short_name fits under an icon.
{
  const bad = [];
  let m = null;
  try { m = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8')); } catch (e) { bad.push(`manifest.webmanifest does not parse: ${e.message}`); }
  if (m) {
    for (const k of ['name', 'short_name', 'start_url']) if (!m[k]) bad.push(`manifest has no ${k}`);
    if (m.display !== 'standalone') bad.push('manifest display must be "standalone"');
    for (const size of ['192x192', '512x512']) if (!m.icons?.some((i) => i.sizes === size)) bad.push(`manifest has no ${size} icon`);
    for (const i of m.icons ?? []) if (!existsSync(`public/${i.src}`)) bad.push(`manifest icon ${i.src} is missing`);
    if (trip?.trip?.title && m.name !== trip.trip.title) bad.push(`manifest name is "${m.name}" — set it to the trip's title, "${trip.trip.title}"`);
    if (m.short_name && [...m.short_name].length > 12) bad.push(`manifest short_name "${m.short_name}" is longer than 12 characters and gets cut under the home-screen icon`);
  }
  if (!/rel="manifest"/.test(readFileSync('public/index.html', 'utf8'))) bad.push('index.html does not link the manifest');
  if (!/serviceWorker\.register\(/.test(src)) bad.push('app.js no longer registers the service worker');
  bad.length ? fail.push(`not installable as an app: ${bad.join('; ')}`)
             : ok.push(`installable: "${m.name}" on the home screen as "${m.short_name}"`);
}

// 5. The CI stamp targets must still exist, or deploys silently stop busting caches
const indexHtml = readFileSync('public/index.html', 'utf8');
const stamps = [];
if (!/id="build"/.test(indexHtml)) stamps.push('index.html has no #build element');
if (!/__BUILD__/.test(indexHtml) && !/id="build">[0-9a-f]{7}</.test(indexHtml)) stamps.push('index.html build placeholder is neither __BUILD__ nor a stamped sha');
// Exactly what CI's `sed s/tripline-v[0-9]*/…/` rewrites.
if (!/^const VERSION = 'tripline-v\d+';$/m.test(sw)) stamps.push("sw.js VERSION is not the literal 'tripline-v<digits>' that CI rewrites");
stamps.length ? fail.push(`CI stamp targets broken: ${stamps.join('; ')}`)
              : ok.push('CI stamp targets present (sw.js VERSION, index.html #build)');

// 6. SW version — just report it
ok.push(`service worker version: ${sw.match(/tripline-[a-z0-9]+/)?.[0]}`);

for (const o of ok) console.log(`  ok   ${o}`);
for (const f of fail) console.log(`  FAIL ${f}`);
console.log(fail.length ? `\n${fail.length} check(s) failed — fix the data, then run node tools/check.mjs again` : '\nall checks passed');
process.exit(fail.length ? 1 : 0);
