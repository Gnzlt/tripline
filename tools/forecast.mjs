#!/usr/bin/env node
/**
 * Regenerate public/data/forecast.json — a static snapshot of the weather outlook
 * for every trip day, at the place we are actually standing that day. The places
 * are each day's `weather` in public/data/trip.json; a day without one gets no strip.
 *
 *   node tools/forecast.mjs
 *
 * Run it again whenever a fresher outlook is wanted; it overwrites the file,
 * which is generated and must never be hand-edited. Nothing else fetches
 * weather at runtime: the app is offline-first, so the numbers are baked in and
 * a weather link in trip.json's `links` is the way to get the real thing on the day.
 *
 * Source: Open-Meteo (no key, no attribution requirement beyond naming it).
 * We pull the blended best_match forecast for display, plus ECMWF and GFS
 * separately purely to measure how far the two disagree. That spread, together
 * with how many days out the date is, decides whether a day is shown as a firm
 * forecast or a soft outlook — a ten-day number deserves a visible hedge.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const API = 'https://api.open-meteo.com/v1/forecast';
const DAILY = 'weather_code,temperature_2m_max,temperature_2m_min,' +
  'precipitation_probability_max,precipitation_sum,wind_speed_10m_max,relative_humidity_2m_mean';

const TRIP = JSON.parse(readFileSync(new URL('../public/data/trip.json', import.meta.url), 'utf8'));
const TZ = TRIP.trip.timezone;

/** WMO weather codes → what to show. */
const WMO = {
  0: ['☀️', 'Clear'], 1: ['🌤', 'Mostly clear'], 2: ['⛅', 'Partly cloudy'], 3: ['☁️', 'Overcast'],
  45: ['🌫', 'Fog'], 48: ['🌫', 'Freezing fog'],
  51: ['🌦', 'Light drizzle'], 53: ['🌦', 'Drizzle'], 55: ['🌦', 'Heavy drizzle'],
  56: ['🌧', 'Freezing drizzle'], 57: ['🌧', 'Freezing drizzle'],
  61: ['🌧', 'Light rain'], 63: ['🌧', 'Rain'], 65: ['🌧', 'Heavy rain'],
  66: ['🌧', 'Freezing rain'], 67: ['🌧', 'Freezing rain'],
  71: ['🌨', 'Light snow'], 73: ['🌨', 'Snow'], 75: ['❄️', 'Heavy snow'], 77: ['🌨', 'Snow grains'],
  80: ['🌦', 'Showers'], 81: ['🌦', 'Showers'], 82: ['⛈', 'Violent showers'],
  85: ['🌨', 'Snow showers'], 86: ['🌨', 'Snow showers'],
  95: ['⛈', 'Thunderstorm'], 96: ['⛈', 'Thunderstorm, hail'], 99: ['⛈', 'Thunderstorm, hail'],
};

// Open-Meteo forecasts 16 days ahead and keeps about three months behind. Days outside
// that get no strip — said out loud below, never filled in from anywhere else.
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const RANGE = [iso(Date.now() - 90 * 864e5), iso(Date.now() + 15 * 864e5)];
const inRange = (d) => d.date >= RANGE[0] && d.date <= RANGE[1];
const DAYS = TRIP.days.filter((d) => d.weather && inRange(d));
const skipped = TRIP.days.filter((d) => d.weather && !inRange(d)).map((d) => d.date);
const first = DAYS[0]?.date, last = DAYS.at(-1)?.date;

async function get(place, model) {
  const q = new URLSearchParams({
    latitude: place.lat, longitude: place.lng, daily: DAILY,
    timezone: TZ, start_date: first, end_date: last,
  });
  if (model) q.set('models', model);
  const r = await fetch(`${API}?${q}`);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} for ${place.name}${model ? ` (${model})` : ''}`);
  return r.json();
}

// One fetch per place, however many days are spent there.
const key = (w) => `${w.lat},${w.lng}`;
const places = new Map(DAYS.map((d) => [key(d.weather), d.weather]));
const data = {};
for (const [k, place] of places) {
  const [blend, ecmwf, gfs] = await Promise.all([get(place), get(place, 'ecmwf_ifs025'), get(place, 'gfs_seamless')]);
  data[k] = { blend: blend.daily, elevation: blend.elevation, ecmwf: ecmwf.daily, gfs: gfs.daily };
  process.stdout.write(`  ${place.name} · grid elevation ${blend.elevation} m\n`);
}

const issued = new Date();
const stamp = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
}).format(issued);

const out = [];
for (const day of DAYS) {
  const src = data[key(day.weather)];
  const i = src.blend.time.indexOf(day.date);
  if (i < 0) throw new Error(`no forecast row for ${day.date}`);

  const pick = (d, k) => d[k]?.[d.time.indexOf(day.date)];
  const hiA = pick(src.ecmwf, 'temperature_2m_max');
  const hiB = pick(src.gfs, 'temperature_2m_max');
  const spread = (hiA != null && hiB != null) ? Math.abs(hiA - hiB) : 99;
  const lead = Math.round((Date.parse(`${day.date}T12:00${TRIP.trip.offset}`) - issued) / 86400e3);

  const code = src.blend.weather_code[i];
  const [icon, en] = WMO[code] ?? ['🌡', 'Mixed'];
  const hi = Math.round(src.blend.temperature_2m_max[i]);
  const lo = Math.round(src.blend.temperature_2m_min[i]);

  // The grid cell is the town; a day spent well above it says how much colder it is up
  // there, ~6.5 °C per 1000 m of extra height over the elevation Open-Meteo reports.
  const high = day.weather.high;
  const drop = high ? Math.round(((high.m - src.elevation) / 1000) * 6.5) : 0;

  out.push({
    date: day.date, place: day.weather.name,
    icon, en, hi, lo,
    pop: Math.round(src.blend.precipitation_probability_max[i] ?? 0),
    mm: Number((src.blend.precipitation_sum[i] ?? 0).toFixed(1)),
    // Daily mean relative humidity at valley level, like the temperatures. No
    // altitude correction: unlike temperature there is no honest rule of thumb
    // for it. null (not 0) when the model has no value, so the UI omits it.
    rh: src.blend.relative_humidity_2m_mean?.[i] == null ? null : Math.round(src.blend.relative_humidity_2m_mean[i]),
    wind: Math.round(src.blend.wind_speed_10m_max[i] ?? 0),
    // A forecast this far out is an outlook, and the UI says so rather than
    // quoting a number the models don't agree on.
    firm: lead <= 6 && spread <= 3.5,
    spread: Number(spread.toFixed(1)),
    ...(high && drop >= 3 ? { high: { m: high.m, drop, name: high.name, ...(high.note ? { note: high.note } : {}) } } : {}),
  });
}

// One day per line, so a refresh reads as a clean diff.
const lines = out.map(({ date, ...d }) => `    ${JSON.stringify(date)}: ${JSON.stringify(d).replace(/,"/g, ', "').replace(/":/g, '": ')}`);
writeFileSync(new URL('../public/data/forecast.json', import.meta.url), `{
  "_": "GENERATED by tools/forecast.mjs — do not edit by hand.",
  "issued": "${stamp}",
  "source": "Open-Meteo · ECMWF + GFS",
  "days": {${lines.length ? `\n${lines.join(',\n')}\n  ` : ''}}
}
`);

process.stdout.write(`\nwrote public/data/forecast.json — issued ${stamp}, ${out.length} day(s)\n`);
if (skipped.length) {
  process.stdout.write(`  no forecast for ${skipped.join(', ')}: outside ${RANGE[0]} … ${RANGE[1]}, so those days get no strip. Run this again closer to the trip.\n`);
}
for (const d of out) {
  process.stdout.write(
    `${d.date}  ${d.place.padEnd(16)} ${String(d.lo).padStart(3)}–${String(d.hi).padStart(3)}°C  ` +
    `${d.icon} ${d.en.padEnd(14)} rain ${String(d.pop).padStart(3)}%  ` +
    `humidity ${d.rh == null ? '   –' : `${String(d.rh).padStart(3)}%`}  ` +
    `${d.firm ? 'forecast' : `outlook (±${d.spread}°)`}${d.high ? `  · ${d.high.name} −${d.high.drop}°` : ''}\n`);
}
