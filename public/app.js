/**
 * Trip timeline app.
 * No framework, no bundler, no dependencies. ES modules only.
 *
 * Everything about the trip itself comes from data/trip.json, whose format is
 * trip.schema.json at the repo root. This file knows nothing about any one trip.
 */
const TRIP = await fetch('data/trip.json').then((r) => r.json());
// The weather is optional: a trip with no snapshot simply has no strip.
const FORECAST = await fetch('data/forecast.json').then((r) => (r.ok ? r.json() : null)).catch(() => null);

const TZ = TRIP.trip.timezone;  // the default; a day or an event can have its own
const LANG = TRIP.trip.language?.code ?? '';
const LOCALE = TRIP.trip.locale ?? 'en-GB';

/**
 * Every word the app itself says. A trip can override any of them in `trip.ui` — the
 * whole page can be in the traveller's own language. {name} is filled in at run time.
 */
const UI = {
  skip: 'Skip to timeline',
  loading: 'Loading…',
  notLongNow: '🧳 Not long now',
  rightNow: '📍 Right now',
  upNext: '⏭️ Up next',
  wrapUp: "🎉 That's a wrap!",
  timeLeft: '{time} left',
  timeUntil: 'in {time}',
  dayOf: 'Day {day} of {days}',
  daysAndStops: '{days} days · {stops} stops',
  notStarted: 'not started',
  complete: 'complete',
  jumpNow: 'Now',
  details: 'Details',
  image: 'Map — tap to enlarge',
  entryCodes: 'Entry codes — tap to enlarge',
  showDriver: 'Show the driver',
  tapFullscreen: 'Tap for fullscreen →',
  copy: 'Copy',
  copied: '✓ Copied',
  holdToCopy: 'Hold to copy',
  alternatives: 'Alternatives',
  live: 'Live · needs signal',
  getThere: 'Get there',
  booking: 'Your booking',
  maps: 'Maps',
  mapsPinned: 'Pinned by coordinates · {place}',
  mapsSearch: 'Searches Google Maps for {place}',
  from: 'From',
  to: 'To',
  outlook: 'outlook',
  humidity: 'Humidity {value}%',
  upAt: '🧥 Up at {place}, {m} m: about {hi}° / {lo}°',
  timesNote: 'All times are local: {zone}. Works offline once loaded.',
  timesNoteZones: 'Times are local to where each thing happens. Works offline once loaded.',
  weatherNote: 'Weather is a snapshot taken {date} by Open-Meteo.',
  updateTitle: 'Trip update ready',
  updateText: 'New plan details are downloaded. Tap Update to see them.',
  update: 'Update',
  updating: 'Updating…',
  later: 'Later',
  installTitle: 'Keep this trip on your phone',
  installText: 'Install it as an app: it opens from your home screen and works with no signal.',
  installIos: 'Tap the Share button, then “Add to Home Screen”.',
  installOther: 'Open your browser menu and choose “Install app” or “Add to Home screen”.',
  install: 'Install',
  installFoot: '📲 Install as an app',
  notNow: 'Not now',
  checking: 'checking…',
  updateReady: 'update ready',
  ...TRIP.ui,
  // The kicker on an event's sheet. Overriding one type keeps the others.
  types: {
    flight: 'Flight', train: 'Train', hotel: 'Hotel', ticket: 'Ticket',
    move: 'Getting around', food: 'Food', sight: 'Sight', admin: 'To do',
    ...TRIP.ui?.types,
  },
};
/** A UI string, with its {placeholders} filled in. */
const say = (key, vars = {}) => UI[key].replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m);

/* ── the data, as the app reads it ───────────────────────────────────────── */

/*
 * Time zones. Every time in trip.json is a wall-clock time where it happens — 09:00 in
 * Bangkok is written 09:00 — and its zone is the event's, else its day's, else the trip's.
 * The browser's own zone data turns it into an instant, daylight saving included, and
 * every time on the page is shown in the zone it happens in, whatever the phone says.
 */
const fmtCache = new Map();
/** One Intl formatter per kind and zone, made once. */
function fmt(kind, tz) {
  const key = `${kind}|${tz}`;
  if (!fmtCache.has(key)) {
    const opts = {
      time: [LOCALE, { hour: '2-digit', minute: '2-digit', hour12: false }],
      full: [LOCALE, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }],
      date: ['en-CA', {}],                                    // YYYY-MM-DD
      offset: ['en-US', { timeZoneName: 'longOffset' }],      // GMT+09:00
      zone: [LOCALE, { timeZoneName: 'shortOffset' }],        // GMT+9
    }[kind];
    fmtCache.set(key, new Intl.DateTimeFormat(opts[0], { ...opts[1], timeZone: tz }));
  }
  return fmtCache.get(key);
}
const part = (kind, tz, ms) => fmt(kind, tz).formatToParts(ms).find((p) => p.type === 'timeZoneName')?.value ?? '';

/** The zone's offset from UTC at that instant, in minutes. */
function offsetMinutes(tz, ms) {
  const m = part('offset', tz, ms).match(/([+-])(\d\d):?(\d\d)?/);
  return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0)) : 0;
}

/** A wall-clock time in a zone, as an instant (ms). A time written with an offset keeps it. */
function zoned(local, tz) {
  if (/(z|[+-]\d\d:?\d\d)$/i.test(local)) return Date.parse(local);
  const asUtc = Date.parse(`${local.length === 16 ? `${local}:00` : local}Z`);
  // The offset depends on the instant, which depends on the offset: two passes settle it,
  // including on the day the clocks change.
  let ms = asUtc - offsetMinutes(tz, asUtc) * 60000;
  ms = asUtc - offsetMinutes(tz, ms) * 60000;
  return ms;
}
const iso = (ms) => new Date(ms).toISOString();

// en-GB writes September as "Sept"; everything else on the page says "Sep".
const sep = (s) => s.replace('Sept', 'Sep');
const fmtLabel = new Intl.DateTimeFormat(LOCALE, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const dayLabel = (date) => sep(fmtLabel.format(new Date(`${date}T12:00:00Z`)).replace(',', ''));

const DAYS = TRIP.days.map((d, i) => ({ ...d, n: i + 1, label: dayLabel(d.date), tz: d.timezone ?? TZ }));
const EVENTS = DAYS.flatMap((d) => d.events.map((e, i) => {
  const tz = e.timezone ?? d.tz;
  // A flight ends somewhere else: its arrival is read, and shown, in the zone it lands in.
  const endTz = e.endTimezone ?? tz;
  return {
    ...e,
    id: e.id ?? `d${d.n}-${i + 1}`,
    day: d.n,
    tz,
    endTz,
    start: iso(zoned(e.start, tz)),
    end: e.end ? iso(zoned(e.end, endTz)) : undefined,
  };
}));
/** Every zone the trip passes through. One zone, and no time needs a label. */
const ZONES = new Set(EVENTS.flatMap((e) => [e.tz, e.endTz]));
const zoneLabel = (tz, ms) => part('zone', tz, ms);

/* ── time ────────────────────────────────────────────────────────────────── */

// ?now=2026-09-26T09:00 offsets the clock so the whole trip can be tested without
// waiting for it. Real clock when absent.
function parseNowParam(raw) {
  if (!raw) return null;
  // A literal '+' decodes to a space in a query string — put it back.
  let s = raw.trim().replace(/\s(?=\d{2}:?\d{2}$)/, '+');
  // No offset supplied? It's the local time of that day of the trip, not the browser's.
  const tz = DAYS.find((d) => d.date === s.slice(0, 10))?.tz ?? DAYS[0].tz;
  const t = /^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(s) ? zoned(s, tz) : Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

const override = parseNowParam(new URLSearchParams(location.search).get('now'));
const skew = override ? override - Date.now() : 0;
const now = () => new Date(Date.now() + skew);

const at = (e) => new Date(e.start).getTime();

/** Which trip day the calendar says it is, each day by its own zone's calendar.
 *  Not the focused event's day: multi-night hotel stays span days, so at 09:00 on
 *  the 29th the "current" event is still the hotel checked into on the 28th. */
function dayOn(t) {
  return DAYS.findLast((d) => fmt('date', d.tz).format(t) === d.date) ?? null;
}
const until = (e) => (e.end ? new Date(e.end).getTime() : at(e));

const fmtDay = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'short', timeZone: 'UTC' });

// Whole minutes, rounded up, so "in 1m" holds until the moment itself.
function countdown(ms) {
  const mins = Math.max(0, Math.ceil(ms / 60000));
  const d = Math.floor(mins / 1440), h = Math.floor((mins % 1440) / 60), m = mins % 60;
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${m}m`;
}

const ICON = {
  flight: '✈️', train: '🚄', hotel: '🏨', ticket: '🎫',
  move: '🚕', food: '🍜', sight: '⛰️', admin: '🎒',
};

/** Where this event's Maps button goes: its own `maps` place, else where it is going,
 *  else where it is. `maps: false` opts out. */
const mapsTarget = (e) => (e.maps === false ? null : (e.maps ?? e.to ?? e.place ?? null));

/** Only events with something behind them are tappable. The rest — "breakfast",
 *  "at the station" — are just signposts and render as plain text. */
const isRich = (e) => Boolean(
  e.details?.length || e.qr?.length || e.driver || e.warnings?.length || mapsTarget(e) ||
  e.alternatives?.length || e.files?.length || e.image || e.links?.length || (e.from && e.to)
);

/* ── maps ────────────────────────────────────────────────────────────────── */

/**
 * Google Maps, through its universal URL: the app where it is installed, the web map
 * where it isn't. Coordinates where the data has them, otherwise a search for the
 * place's local name, which is what its own signs say.
 */
function mapsHref(p) {
  const query = p.geo ? p.geo.join(',') : (p.local ?? p.name);
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/* ── clipboard ───────────────────────────────────────────────────────────── */

/** Clipboard write, with the fallbacks older WebViews need. */
async function writeClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // In-app browsers and older WebViews reject the async API.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
    document.body.append(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok;
  }
}

/** Last resort when the clipboard is denied: select the text in place so the
 *  platform's own long-press → Copy still works. */
function selectInPlace(node) {
  if (!node) return;
  const r = document.createRange();
  r.selectNodeContents(node);
  const sel = getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
}

/**
 * Say it on the button for a moment, green when it worked. The words are the span beside
 * an app's mark, or the button itself when it has none. The resting label is kept once,
 * so a second tap mid-message can never leave "Copied" stuck on the button.
 */
function flash(btn, text, ok, ms) {
  const label = btn.querySelector('span') ?? btn;
  label.dataset.rest ??= label.textContent;
  label.textContent = text;
  btn.classList.toggle('is-copied', ok);
  setTimeout(() => { label.textContent = label.dataset.rest; btn.classList.remove('is-copied'); }, ms);
}

/** Copy from a button that is a word, not the icon: the driver card's Copy, the
 *  lightbox's. If the clipboard is denied, `source` — the local text itself — is selected. */
async function copy(text, btn, source) {
  const ok = await writeClipboard(text);
  if (!ok) selectInPlace(source);
  flash(btn, ok ? UI.copied : UI.holdToCopy, ok, 1800);
}

/* ── dom helpers ─────────────────────────────────────────────────────────── */

const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
/** Text in the trip's local language, tagged so it gets the right font and voice. */
const localEl = (tag, cls, text) => {
  const n = el(tag, cls, text);
  if (LANG) n.lang = LANG;
  return n;
};

/* Material Symbols Outlined, 24px / weight 400 — the glyphs drawn inline so they
 * inherit currentColor and the sheet's own type colour. viewBox is Material's own. */
const GLYPH = {
  humidity: 'M622.5-257.5Q640-275 640-300t-17.5-42.5Q605-360 580-360t-42.5 17.5Q520-325 520-300t17.5 42.5Q555-240 '
      + '580-240t42.5-17.5ZM378-242l260-260-56-56-260 260 56 56Zm44.5-215.5Q440-475 440-500t-17.5-42.5Q405-560 380-560t-42.5 '
      + '17.5Q320-525 320-500t17.5 42.5Q355-440 380-440t42.5-17.5ZM251.5-174Q160-268 160-408q0-100 79.5-217.5T480-880q161 137 '
      + '240.5 254.5T800-408q0 140-91.5 234T480-80q-137 0-228.5-94ZM652-230.5Q720-301 720-408q0-73-60.5-165T480-774Q361-665 '
      + '300.5-573T240-408q0 107 68 177.5T480-160q104 0 172-70.5ZM480-480Z',
  copy: 'M360-240q-33 0-56.5-23.5T280-320v-480q0-33 23.5-56.5T360-880h360q33 0 56.5 23.5T800-800v480q0 33-23.5 '
      + '56.5T720-240H360Zm0-80h360v-480H360v480ZM200-80q-33 0-56.5-23.5T120-160v-560h80v560h440v80H200Zm160-240v-480 480Z',
  check: 'M382-240 154-468l57-57 171 171 367-367 57 57-424 424Z',
  open: 'M200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h280v80H200v560h560v-280h80v280q0 33-23.5 56.5T760-120H200Zm188-212-56-56 372-372H560v-80h280v280h-80v-144L388-332Z',
};

function glyph(name, cls) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 -960 960 960');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  if (cls) svg.setAttribute('class', cls);
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', GLYPH[name]);
  path.setAttribute('fill', 'currentColor');
  svg.append(path);
  return svg;
}

/**
 * The copy control, everywhere: an icon, not the word "Copy".
 *
 * Both glyphs are in the DOM and CSS swaps them, so confirmation never reflows the
 * row it sits in — a label that grows from "Copy" to "Copied" shoves the value it
 * belongs to, which is the one thing you are looking at when you press it.
 */
function copyBtn(text, aria) {
  const b = el('button', 'ico-copy');
  b.type = 'button';
  b.setAttribute('aria-label', aria);
  b.append(glyph('copy', 'g-copy'), glyph('check', 'g-done'));
  b.addEventListener('click', async () => {
    const ok = await writeClipboard(text);
    if (!ok) selectInPlace(b.closest('div')?.querySelector('dd') ?? b.previousElementSibling);
    b.classList.toggle('is-copied', ok);
    b.classList.toggle('is-failed', !ok);
    b.setAttribute('title', ok ? UI.copied : UI.holdToCopy);
    setTimeout(() => {
      b.classList.remove('is-copied', 'is-failed');
      b.removeAttribute('title');
    }, 1600);
  });
  return b;
}

/** An icon from the data: the name of a mark in assets/icons/, or an emoji. */
function iconEl(icon, cls) {
  if (/^[a-z0-9-]+$/.test(icon)) {
    const img = el('img', cls);
    img.src = `assets/icons/${icon}.svg`;
    img.alt = ''; img.width = 20; img.height = 20;
    return img;
  }
  return el('span', `${cls} is-emoji`, icon);
}

/** Action button or link, labelled with the mark of what it opens. */
function action(tag, icon, label, cls = 'sh-act') {
  const n = el(tag, cls);
  if (tag === 'button') n.type = 'button';
  if (icon) n.append(iconEl(icon, 'act-ico'));
  n.append(el('span', null, label));
  return n;
}

/* ── the trip's own words: header, footer, page title ────────────────────── */

function renderChrome() {
  const t = TRIP.trip;
  document.title = t.title;
  document.documentElement.lang = LOCALE;
  // The words in index.html, in the trip's language.
  for (const [id, key] of [['skip', 'skip'], ['statusTitle', 'loading'], ['updateTitle', 'updateTitle'],
    ['updateText', 'updateText'], ['updateGo', 'update'], ['updateLater', 'later'], ['jumpLabel', 'jumpNow'],
    ['installTitle', 'installTitle'], ['installGo', 'install'], ['installLater', 'notNow'], ['installFoot', 'installFoot']]) {
    const n = document.getElementById(id);
    if (n) n.textContent = UI[key];
  }
  const first = DAYS[0];
  const year = first.date.slice(0, 4);

  // The wordmark changes colour piece by piece, in the four type colours of the brand.
  const pieces = Array.isArray(t.brand) ? t.brand : [t.brand ?? t.title];
  const mark = $('#brandName');
  mark.setAttribute('aria-label', `${pieces.join('')} ${year}`);
  mark.replaceChildren(...pieces.map((p, i) => {
    const b = el('b', null, p);
    b.style.setProperty('--c', ['var(--red)', 'var(--orange)', 'var(--green)', 'var(--blue)'][i % 4]);
    return b;
  }));
  const y = el('b', 'brand-year', year);
  y.style.setProperty('--c', 'var(--muted)');
  mark.append(y);

  // To the day the trip actually ends: a midnight flight home lands on the day after.
  const lastEnd = EVENTS.reduce((a, e) => (until(e) > until(a) ? e : a));
  const lastDate = fmt('date', lastEnd.endTz).format(until(lastEnd));
  const range = `${sep(fmtDay.format(new Date(`${first.date}T12:00:00Z`)))} – ${sep(fmtDay.format(new Date(`${lastDate}T12:00:00Z`)))} ${year}`;
  // A wordmark in capitals reads as a name in the footer: TRIPLINE → Tripline.
  const word = pieces.join('');
  const name = word === word.toUpperCase() ? word[0] + word.slice(1).toLowerCase() : word;
  $('#footTrip').replaceChildren(...(t.brand ? [el('strong', null, name), ` · ${t.title}`] : [el('strong', null, t.title)]), ` · ${range}`);
  // One zone: name it, and its offset if the clocks don't change during the trip.
  const [only] = ZONES;
  const offsets = new Set([zoneLabel(only, at(EVENTS[0])), zoneLabel(only, until(lastEnd))]);
  $('#footTz').textContent = ZONES.size > 1
    ? UI.timesNoteZones
    : say('timesNote', { zone: offsets.size === 1 ? `${only}, ${[...offsets][0]}` : only });
}

/* ── render the timeline ─────────────────────────────────────────────────── */

const timeline = $('#timeline');
const nodes = new Map(); // event id -> <li>

/**
 * The day's weather, baked in at build time.
 *
 * Informative only — never tappable. The numbers are a snapshot (see
 * tools/forecast.mjs), so anything the models disagreed on is labelled an
 * outlook rather than dressed up as a forecast.
 */
function wxStrip(day) {
  const w = FORECAST?.days?.[day.date];
  if (!w) return null;

  const strip = el('div', 'day-wx');
  strip.append(
    el('span', 'wx-ico', w.icon),
    el('b', 'wx-hi', `${w.hi}°`),
    el('span', 'wx-lo', `/ ${w.lo}°`),
  );
  // Humidity sits with the temperatures it qualifies, leaving the right-hand side
  // to the rain chance alone. Material's humidity glyph, not an emoji: drawn in
  // the text colour it cannot be mistaken for the 💧 over there.
  if (w.rh != null) {
    const rh = el('span', 'wx-rh', `${w.rh}%`);
    rh.prepend(glyph('humidity'));
    rh.title = say('humidity', { value: w.rh });
    strip.append(rh);
  }
  strip.append(
    el('span', 'wx-text', w.local ? `${w.en} · ${w.local}` : w.en),
    el('span', 'wx-pop', `💧 ${w.pop}%`),
  );
  if (!w.firm) strip.append(el('span', 'wx-soft', UI.outlook));

  if (!w.high) return strip;

  // The grid cell is the town. Say what it will feel like where we actually are.
  const wrap = el('div', 'day-wx-wrap');
  const note = w.high.note ? ` — ${w.high.note}` : '';
  wrap.append(strip, el('p', 'wx-alt',
    say('upAt', { place: w.high.name, m: w.high.m, hi: w.hi - w.high.drop, lo: w.lo - w.high.drop }) + note));
  return wrap;
}

/** An event's time on the timeline; with its zone when that isn't its day's. */
function evTime(e) {
  const t = fmt('time', e.tz).format(at(e));
  return e.tz === DAYS[e.day - 1].tz ? t : `${t} ${zoneLabel(e.tz, at(e))}`;
}

function buildTimeline() {
  const frag = document.createDocumentFragment();

  for (const day of DAYS) {
    const evs = EVENTS.filter((e) => e.day === day.n);
    if (!evs.length) continue;

    const accent = ['var(--red)', 'var(--orange)', 'var(--green)', 'var(--blue)'][(day.n - 1) % 4];
    const section = el('section', 'day');
    section.style.setProperty('--accent', accent);

    const head = el('div', 'day-head');
    head.append(el('span', 'day-n', String(day.n)));
    const meta = el('div', 'day-meta');
    meta.append(el('span', 'day-date', day.label), el('span', 'day-title', day.title));
    // A trip across zones says where the clock changes: on the first day, and on each day
    // whose zone isn't the day before's.
    const before = DAYS[day.n - 2];
    if (ZONES.size > 1 && (!before || before.tz !== day.tz)) {
      meta.querySelector('.day-date').append(el('span', 'day-tz', zoneLabel(day.tz, zoned(`${day.date}T12:00`, day.tz))));
    }
    head.append(meta);
    if (day.local) head.append(localEl('span', 'day-local', day.local));
    section.append(head);
    const wx = wxStrip(day);
    if (wx) section.append(wx);

    const list = el('ul', 'events');
    for (const e of evs) {
      const rich = isRich(e);
      const li = el('li', rich ? 'ev' : 'ev ev--plain');
      li.dataset.type = e.type;
      li.dataset.id = e.id;
      if (e.pin) li.dataset.pin = '1';

      li.append(el('span', 'ev-chip', ICON[e.type] ?? '•'));

      if (rich) {
        const card = el('button', 'ev-card');
        card.type = 'button';

        const top = el('div', 'ev-top');
        top.append(el('span', 'ev-time', evTime(e)));
        if (e.qr?.length) top.append(el('span', 'tag', `QR ×${e.qr.length}`));
        if (e.driver) top.append(el('span', 'tag', TRIP.trip.language?.name ?? 'Local'));
        if (e.warnings?.length) top.append(el('span', 'tag warn', '!'));
        top.append(el('span', 'ev-chev', '›'));
        card.append(top, el('span', 'ev-title', e.title));
        if (e.summary) card.append(el('span', 'ev-sub', e.summary));

        card.addEventListener('click', () => openSheet(e));
        li.append(card);
      } else {
        const row = el('div', 'ev-plain');
        const line = el('div');
        line.append(el('span', 'ev-time', evTime(e)), el('span', 'ev-title', e.title));
        row.append(line);
        if (e.summary) row.append(el('span', 'ev-sub', e.summary));
        li.append(row);
      }

      list.append(li);
      nodes.set(e.id, li);
    }
    section.append(list);
    frag.append(section);
  }
  timeline.append(frag);
}

/* ── live status ─────────────────────────────────────────────────────────── */

const statusEl = $('#status');
const ui = {
  label: $('#statusLabel'), count: $('#statusCount'), card: $('#statusCard'),
  icon: $('#statusIcon'), title: $('#statusTitle'), sub: $('#statusSub'),
  time: $('#statusTime'), progress: $('#statusProgress'),
};
const tripFill = $('#tripFill');
const tripPct = $('#tripPct');

let focusEvent = null;

/** The event happening now: the most recently started one that hasn't ended.
 *  Latest-start wins, so an activity beats the hotel stay enclosing it. */
function resolve(t) {
  let current = null;
  for (const e of EVENTS) {
    if (at(e) <= t && t < until(e) && (!current || at(e) > at(current))) current = e;
  }
  const next = EVENTS.find((e) => at(e) > t) ?? null;
  return { current, next };
}

let landingEvent = null;

/** Where the page lands. Usually the focused event — but a stay checked into on an
 *  earlier day would drag the page back to yesterday, so then it is today's
 *  latest-started event, or today's first if nothing has started yet. Once the trip
 *  is over it is the start, because then the page is read as the story of the trip. */
function landingFor(ev, today, t, mode) {
  if (mode === 'done') return EVENTS[0];
  if (!ev || !today || ev.day >= today.n) return ev;
  const todays = EVENTS.filter((e) => e.day === today.n);
  return todays.filter((e) => at(e) <= t).at(-1) ?? todays[0] ?? ev;
}

/** The status card once it is all over: the trip's own words, or a count. */
function wrapUp() {
  return TRIP.trip.wrap ?? { title: TRIP.trip.title, sub: say('daysAndStops', { days: DAYS.length, stops: EVENTS.length }) };
}

function tick() {
  const t = now().getTime();
  const today = dayOn(t);

  const { current, next } = resolve(t);
  // The trip ends when the last thing in it does — a hotel stay can outlast the last
  // event to start.
  const first = EVENTS[0], last = EVENTS.at(-1);
  const end = Math.max(...EVENTS.map(until));

  let mode, ev, label, timeText, progress = 0;

  if (t < at(first)) {
    mode = 'before'; ev = first; label = UI.notLongNow; timeText = countdown(at(first) - t);
  } else if (t >= end) {
    mode = 'done'; ev = last; label = UI.wrapUp; timeText = '';
  } else if (current) {
    mode = 'now'; ev = current; label = UI.rightNow;
    const span = until(current) - at(current);
    progress = span > 0 ? Math.min(1, (t - at(current)) / span) : 0;
    timeText = span > 0 ? say('timeLeft', { time: countdown(until(current) - t) }) : '';
  } else {
    mode = 'next'; ev = next; label = UI.upNext; timeText = say('timeUntil', { time: countdown(at(next) - t) });
  }

  focusEvent = ev;
  landingEvent = landingFor(ev, today, t, mode);
  statusEl.dataset.type = ev.type;
  statusEl.classList.toggle('is-live', mode === 'now' && progress > 0);
  ui.label.textContent = label;
  const wrap = mode === 'done' ? wrapUp() : null;
  ui.icon.textContent = wrap ? '🎒' : (ICON[ev.type] ?? '•');
  ui.title.textContent = wrap ? wrap.title : ev.title;
  ui.sub.textContent = wrap ? (wrap.sub ?? '') : (ev.summary || ev.place?.local || sep(fmt('full', ev.tz).format(at(ev))));
  ui.time.textContent = timeText;
  ui.progress.style.width = `${progress * 100}%`;
  statusEl.style.setProperty('--progress', progress);

  // Only offer the tap when there is actually something behind it.
  const tappable = mode !== 'done' && isRich(ev);
  ui.card.dataset.static = tappable ? '0' : '1';
  ui.card.disabled = !tappable;

  ui.count.textContent =
    mode === 'before' ? say('daysAndStops', { days: DAYS.length, stops: EVENTS.length }) :
    mode === 'done' ? '' : say('dayOf', { day: (today ?? { n: ev.day }).n, days: DAYS.length });

  // Whole-trip progress in the header
  const span = end - at(first);
  const pct = Math.max(0, Math.min(1, (t - at(first)) / span));
  tripFill.style.width = `${pct * 100}%`;
  tripPct.textContent = mode === 'before' ? UI.notStarted : mode === 'done' ? UI.complete : `${Math.round(pct * 100)}%`;

  // per-event state. Once the trip is over nothing is "past" any more: the page is the
  // record of the trip, and greying all of it out would only make it harder to read.
  for (const e of EVENTS) {
    const li = nodes.get(e.id);
    li.classList.toggle('is-past', mode !== 'done' && until(e) <= t);
    li.classList.toggle('is-now', e === current);
  }
}

/* ── live info ───────────────────────────────────────────────────────────── */

/** Network-only links, so they sit apart from the offline timeline. */
function renderLive() {
  const liveEl = $('#live');
  const links = TRIP.links ?? [];
  liveEl.hidden = !links.length;
  liveEl.replaceChildren(...links.map((l) => {
    const a = el('a', 'live-chip');
    a.href = l.url; a.target = '_blank'; a.rel = 'noopener';
    a.append(iconEl(l.icon, 'live-ico'));
    const t = el('span', 'live-text');
    t.append(el('b', null, l.label));
    if (l.sub) t.append(el('small', null, l.sub));
    a.append(t);
    return a;
  }));
}

/* ── detail sheet ────────────────────────────────────────────────────────── */

const sheet = $('#sheet');
const sheetBody = $('#sheetBody');

function when(e) {
  const a = sep(fmt('full', e.tz).format(at(e)));
  if (!e.end) return a;
  // Crossing zones, each end says which: 10:05 GMT+9 → 14:20 GMT+7.
  if (e.endTz !== e.tz) {
    return `${a} ${zoneLabel(e.tz, at(e))} → ${sep(fmt('full', e.endTz).format(until(e)))} ${zoneLabel(e.endTz, until(e))}`;
  }
  // Same day where it happens — the phone's own zone would split a stay at its midnight.
  const sameDay = fmt('date', e.tz).format(at(e)) === fmt('date', e.tz).format(until(e));
  return `${a} → ${sameDay ? fmt('time', e.tz).format(until(e)) : sep(fmt('full', e.tz).format(until(e)))}`;
}

/**
 * The venue's own page — the hotel, the attraction, the theatre.
 *
 * Not the order: what you want standing outside a place at 22:00 is its photos,
 * address, check-in hours and reviews, and that is the property page.
 */
function placeLink(e) {
  const url = e.place?.url;
  if (!url) return null;
  // The site name is only needed for the accessible label — the icon at the end of
  // the title says "this opens somewhere else" without spending a whole button.
  return { site: new URL(url).hostname.replace(/^www\./, ''), href: url };
}

function openSheet(e) {
  sheetBody.replaceChildren();
  sheet.dataset.type = e.type;

  const kicker = el('div', 'sh-kicker');
  kicker.append(el('span', null, ICON[e.type] ?? '•'), el('span', null, (UI.types[e.type] ?? e.type).toLocaleUpperCase(LOCALE)));

  // A booked hotel or activity carries its own page. The link belongs to the title —
  // it is that place — so it rides at the end of it rather than taking a button.
  const pl = placeLink(e);
  const title = el('h2', 'sh-title', e.title);
  if (pl) {
    const a = el('a', 'ico-open');
    a.href = pl.href; a.target = '_blank'; a.rel = 'noopener';
    a.setAttribute('aria-label', `Open ${e.place.name ?? e.title} on ${pl.site}`);
    a.title = `Open on ${pl.site}`;
    a.append(glyph('open'));
    title.append(a);
  }
  sheetBody.append(kicker, title);

  // The local name is the thing you hand to a driver or paste into a map, so the copy
  // control lives here, next to it. Where an event has no place but does have a map
  // target of its own, that target *is* where you are going, so show it.
  const target = mapsTarget(e);
  const localName = e.place?.local ?? (e.from && e.to ? null : target?.local);
  if (e.place?.name && e.place.name !== e.title) sheetBody.append(el('div', 'sh-place', e.place.name));
  if (localName) {
    const row = el('div', 'sh-place has-copy');
    row.append(localEl('span', null, localName), copyBtn(localName, `Copy ${localName}`));
    sheetBody.append(row);
  }

  sheetBody.append(el('div', 'sh-when', when(e)));

  if (e.from && e.to) {
    const route = el('div', 'sh-route');
    for (const [k, v] of [['from', e.from], ['to', e.to]]) {
      const row = el('div');
      row.append(el('span', null, k === 'from' ? UI.from : UI.to),
        el('strong', null, [v.name, v.local].filter(Boolean).join(' · ')));
      // A train has no place, so this is where its station names are copied from.
      if (v.local) row.append(copyBtn(v.local, `Copy ${v.local}`));
      route.append(row);
    }
    sheetBody.append(route);
  }

  if (e.summary) sheetBody.append(el('p', null, e.summary));

  for (const w of e.warnings ?? []) {
    const box = el('div', 'sh-warn');
    box.append(el('span', null, '⚠️'), el('div', null, w));
    sheetBody.append(box);
  }

  if (e.details?.length) {
    sheetBody.append(el('h3', 'sh-h', UI.details));
    const dl = el('dl', 'sh-dl');
    for (const row of e.details) {
      const wrap = el('div');
      wrap.append(el('dt', null, row.label));
      const dd = row.local ? localEl('dd', 'local') : el('dd');
      if (/^[A-Z0-9.\-]{5,}$/.test(row.value)) dd.append(el('code', null, row.value));
      else dd.textContent = row.value;
      wrap.append(dd);
      // Anything short enough to be an identifier, a name or an address is worth copying.
      if (row.value.length <= 120) {
        wrap.append(copyBtn(row.value, `Copy ${row.label}`));
        wrap.classList.add('has-copy');
      }
      dl.append(wrap);
    }
    sheetBody.append(dl);
  }

  // A drawn map earns its place where a paragraph of directions would not: which stop,
  // which way along the ridge, and what the two ways down cost you.
  if (e.image) {
    sheetBody.append(el('h3', 'sh-h', UI.image));
    const fig = el('figure', 'sh-map');
    const img = el('img');
    // Not lazy: inside a <dialog> the lazy heuristic never fires, the image stays
    // unloaded and the figure collapses to zero height. It is one precached file.
    img.src = e.image.src; img.alt = e.image.caption ?? e.title; img.decoding = 'async';
    fig.append(img);
    fig.addEventListener('click', () => openLightbox({ img: e.image.src, cap: e.image.caption, doc: true }));
    sheetBody.append(fig);
  }

  if (e.qr?.length) {
    sheetBody.append(el('h3', 'sh-h', UI.entryCodes));
    const grid = el('div', 'sh-qrs');
    for (const q of e.qr) {
      const fig = el('figure', 'sh-qr');
      const img = el('img');
      img.src = q.src; img.alt = `QR code — ${q.label ?? ''}`; img.loading = 'lazy'; img.decoding = 'async';
      fig.append(img, el('figcaption', null, q.label ?? ''));
      fig.addEventListener('click', () => openLightbox({ img: q.src, cap: q.label }));
      grid.append(fig);
    }
    sheetBody.append(grid);
  }

  if (e.driver) {
    sheetBody.append(el('h3', 'sh-h', UI.showDriver));
    const card = el('button', 'sh-driver');
    card.type = 'button';
    const big = localEl('div', 'local', e.driver.local);
    card.append(big);
    if (e.driver.en) card.append(el('div', 'en', e.driver.en));
    card.append(el('div', 'hint', UI.tapFullscreen));
    card.addEventListener('click', () => openLightbox({ local: e.driver.local, en: e.driver.en }));
    sheetBody.append(card);

    const row = el('div', 'sh-actions');
    const cp = action('button', null, UI.copy);
    cp.addEventListener('click', () => copy(e.driver.local, cp, big));
    row.append(cp);
    sheetBody.append(row);
  }

  if (e.alternatives?.length) {
    sheetBody.append(el('h3', 'sh-h', UI.alternatives));
    const ul = el('ul', 'sh-list');
    for (const a of e.alternatives) ul.append(el('li', null, a));
    sheetBody.append(ul);
  }

  if (e.links?.length) {
    sheetBody.append(el('h3', 'sh-h', UI.live));
    const wrap = el('div', 'sh-actions');
    for (const l of e.links) {
      const a = action('a', l.icon, l.label);
      a.href = l.url; a.target = '_blank'; a.rel = 'noopener';
      wrap.append(a);
    }
    sheetBody.append(wrap);
  }

  if (target || e.files?.length) {
    // One row at the bottom holds everything that leaves this sheet. A train has no
    // map target of its own, so the heading follows what is actually in the row.
    sheetBody.append(el('h3', 'sh-h', target ? UI.getThere : UI.booking));
    const actions = el('div', 'sh-actions');

    if (target) {
      const a = action('a', 'maps', UI.maps, 'sh-act primary');
      a.href = mapsHref(target);
      a.target = '_blank'; a.rel = 'noopener';
      actions.append(a);
    }

    // The booking documents. Precached by the service worker, so they still open with
    // no signal at all — the fallback for when everything else fails.
    for (const f of e.files ?? []) {
      if (/\.pdf$/i.test(f.src)) {
        const v = action('a', 'pdf', f.label ?? 'File');
        v.href = f.src;
        v.target = '_blank'; v.rel = 'noopener';
        actions.append(v);
      } else {
        // An image belongs in the app's own fullscreen viewer, not a browser tab: same
        // wake lock as the QR codes, because a ticket is held up at a gate the same way.
        const v = action('button', 'ticket', f.label ?? 'Ticket');
        v.addEventListener('click', () => openLightbox({ img: f.src, cap: f.caption ?? e.title, doc: true }));
        actions.append(v);
      }
    }

    sheetBody.append(actions);

    if (target) {
      sheetBody.append(el('div', 'sh-note', say(target.geo ? 'mapsPinned' : 'mapsSearch', { place: target.local ?? target.name })));
    }
  }

  sheet.showModal();
  sheetBody.scrollTop = 0;
}

ui.card.addEventListener('click', () => {
  if (focusEvent && isRich(focusEvent)) openSheet(focusEvent);
});

/* ── fullscreen lightbox (QR at a gate, local text in a taxi) ───────────── */

const lightbox = $('#lightbox');
const lightboxBody = $('#lightboxBody');
let wakeLock = null;

function openLightbox({ img, cap, local, en, doc = false }) {
  lightboxBody.replaceChildren();
  // A QR is a square blown up as large as it goes; a ticket is a tall page that has to
  // fit on screen instead, and must not be rendered with pixelated edges.
  lightboxBody.classList.toggle('is-doc', doc);
  if (img) {
    const i = el('img'); i.src = img; i.alt = cap ?? 'QR code';
    lightboxBody.append(i);
    if (cap) lightboxBody.append(el('div', 'cap', cap));
  } else {
    const big = localEl('div', 'big-local', local);
    lightboxBody.append(big);
    if (en) lightboxBody.append(el('div', 'big-en', en));
    const cp = el('button', 'sh-act', `📋 ${UI.copy}`);
    cp.type = 'button';
    cp.addEventListener('click', () => copy(local, cp, big));
    lightboxBody.append(cp);
  }
  lightbox.showModal();
  keepAwake();
}

/** Keep the screen on while something is being scanned or read. */
async function keepAwake() {
  if (wakeLock && !wakeLock.released) return;
  try {
    const lock = await navigator.wakeLock?.request('screen');
    // Closed while the request was in flight: let it go rather than hold it forever.
    if (lightbox.open) wakeLock = lock; else lock?.release().catch(() => {});
  } catch { /* unsupported, or refused while the page is hidden */ }
}

// ✕, a tap on the backdrop and Escape all end in `close`, and that lets the lock go.
$('#lightboxClose').addEventListener('click', () => lightbox.close());
lightbox.addEventListener('click', (ev) => { if (ev.target === lightbox) lightbox.close(); });
lightbox.addEventListener('close', () => { wakeLock?.release?.().catch(() => {}); wakeLock = null; });
// The system drops the lock whenever the page is hidden — a trip to another app and
// back, say. Take it again if the code is still up on the screen.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && lightbox.open) keepAwake();
});

/* ── jump to now ─────────────────────────────────────────────────────────── */

const jump = $('#jumpNow');

function scrollToFocus(behavior = 'smooth') {
  if (!landingEvent) return;
  const li = nodes.get(landingEvent.id);
  // The first event is read from the top of the page, day header and all.
  const top = landingEvent === EVENTS[0] ? 0 : li.getBoundingClientRect().top + window.scrollY - 150;
  window.scrollTo({ top, behavior });
}
jump.addEventListener('click', () => scrollToFocus());

// Show the button only when the focused event is off screen.
const io = new IntersectionObserver(
  (entries) => {
    for (const en of entries) {
      if (en.target.dataset.id === landingEvent?.id) jump.hidden = en.isIntersecting;
    }
  },
  { rootMargin: '-150px 0px -40% 0px' }
);

/* ── boot ────────────────────────────────────────────────────────────────── */

renderChrome();
renderLive();

// The footer says when the weather was taken — only when there is weather to show.
const wxNote = $('#wxNote');
if (FORECAST && Object.keys(FORECAST.days ?? {}).length) {
  const [y, m, d] = FORECAST.issued.split('-').map(Number);
  wxNote.textContent = say('weatherNote', { date: sep(fmtDay.format(new Date(Date.UTC(y, m - 1, d, 12)))) });
  wxNote.hidden = false;
}

buildTimeline();
tick();
setInterval(tick, 1000);
for (const li of nodes.values()) io.observe(li);

// Keep sticky day headers clear of the status bar.
const setStick = () => {
  const h = statusEl.getBoundingClientRect().height;
  document.documentElement.style.setProperty('--stick', `${Math.round(h)}px`);
};
setStick();
new ResizeObserver(setStick).observe(statusEl);

requestAnimationFrame(() => scrollToFocus('auto'));

// CI rewrites __BUILD__ with the commit sha; unsubstituted means a local checkout.
const buildEl = $('#build');
if (buildEl) {
  if (buildEl.textContent.startsWith('__')) buildEl.textContent = 'local';

  // Tap the build id to force an update check — answers "am I on the latest?"
  buildEl.closest('p')?.addEventListener('click', async () => {
    const label = buildEl.textContent;
    buildEl.textContent = UI.checking;
    const reg = await navigator.serviceWorker?.getRegistration();
    await reg?.update().catch(() => {});
    setTimeout(() => {
      buildEl.textContent = reg?.waiting ? UI.updateReady : label;
    }, 1200);
  });
}

if (override) console.info(`[tripline] clock overridden to ${new Date(Date.now() + skew).toISOString()}`);

/* ── updates ─────────────────────────────────────────────────────────────── */

/**
 * PWA update flow.
 *
 * The service worker no longer activates itself, so a new build sits in `waiting`
 * until the user accepts the offer, or the app goes to the background with nothing
 * open. Nothing reloads underneath you — which matters when the thing on screen is
 * a QR code at a ticket gate.
 */
function initUpdates() {
  if (!('serviceWorker' in navigator)) return;

  navigator.serviceWorker.register('sw.js').then((reg) => {
    const offer = () => {
      // Only an update if something is already controlling the page; otherwise
      // this is just the first install.
      if (reg.waiting && navigator.serviceWorker.controller) showUpdate(reg);
    };

    offer();
    reg.addEventListener('updatefound', () => {
      const sw = reg.installing;
      sw?.addEventListener('statechange', () => {
        if (sw.state === 'installed') offer();
      });
    });

    // Look for a new build when the app comes back to the foreground, and hourly
    // while it stays open. sw.js is served no-cache, so this really re-fetches.
    const check = () => reg.update().catch(() => {});
    document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });

    // Apply a waiting update while the app is in the background, so the reload happens
    // unseen. Never with a sheet or a QR/ticket open: that is what you'd come back to.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && reg.waiting && navigator.serviceWorker.controller && !sheet.open && !lightbox.open) {
        reg.waiting.postMessage({ type: 'SKIP_WAITING' });
      }
    });
    setInterval(check, 60 * 60 * 1000);
  }).catch(() => {});

  // The new worker took over — reload once so the page matches its assets.
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });
}

function showUpdate(reg) {
  const bar = $('#update');
  if (!bar) return;
  bar.hidden = false;
  if (bar.dataset.wired === '1') return;
  bar.dataset.wired = '1';

  $('#updateGo').addEventListener('click', () => {
    $('#updateGo').textContent = UI.updating;
    reg.waiting?.postMessage({ type: 'SKIP_WAITING' });
  }, { once: true });

  // "Later" is a snooze, not a dismissal: the offer comes back the next time the app
  // returns to the foreground, so a stale plan can't be forgotten for the whole trip.
  $('#updateLater').addEventListener('click', () => { bar.hidden = true; });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && reg.waiting) bar.hidden = false;
  });
}

initUpdates();

/* ── install ─────────────────────────────────────────────────────────────── */

/**
 * The app is a PWA: installed, it opens from the home screen like any other app and works
 * with no signal. People rarely know that, so it is offered once, at the bottom like the
 * update card, and stays in the footer. Chrome and Edge hand over a real install prompt;
 * Safari on iPhone has none, so there the card says how. Installed, none of it shows.
 */
function initInstall() {
  // The home-screen name, as the manifest gives it (Safari reads this meta).
  fetch('manifest.webmanifest').then((r) => r.json()).then((m) => {
    $('meta[name="apple-mobile-web-app-title"]')?.setAttribute('content', m.short_name ?? m.name ?? TRIP.trip.title);
  }).catch(() => {});

  const installed = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  if (installed) return;

  const card = $('#install'), go = $('#installGo'), text = $('#installText'), foot = $('#installFoot');
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const KEY = 'tripline-install-offered';
  let deferred = null;

  const show = () => {
    text.textContent = deferred ? UI.installText : ios ? UI.installIos : UI.installOther;
    go.hidden = !deferred;
    card.hidden = false;
  };
  // Once per device, and never on top of an update offer.
  const offerOnce = () => {
    try { if (localStorage.getItem(KEY)) return; localStorage.setItem(KEY, '1'); } catch { /* private mode */ }
    if ($('#update').hidden) show();
  };

  foot.hidden = false;
  foot.addEventListener('click', show);
  $('#installLater').addEventListener('click', () => { card.hidden = true; });
  go.addEventListener('click', async () => {
    card.hidden = true;
    deferred?.prompt();
    await deferred?.userChoice;
    deferred = null;
  });

  addEventListener('beforeinstallprompt', (ev) => {
    ev.preventDefault();  // our card instead of the browser's mini-infobar
    deferred = ev;
    setTimeout(offerOnce, 4000);
  });
  addEventListener('appinstalled', () => { card.hidden = true; foot.hidden = true; });
  // Safari never fires beforeinstallprompt: offer the instructions on its own.
  if (ios) setTimeout(offerOnce, 4000);
}

initInstall();
