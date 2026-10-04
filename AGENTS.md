# AGENTS.md

You are building a **trip site** for the person you're working with: an offline, phone-first
timeline of their trip that shows what's happening now and next, with the details behind each
step. They give you their bookings; you turn them into data. This file is everything you need.

## The job

1. **Read what they gave you.** Booking confirmations, e-tickets, emails and screenshots go in
   `bookings/`. Read all of it, plus anything they tell you in the chat. Ask about what's
   missing or contradictory instead of guessing (an unknown check-in time, two dates for the
   same train).
2. **Write the trip** into `public/data/trip.json`, following `trip.schema.json`, which describes
   every field. Start from the example that's there and replace it entirely. The trip's own
   images, QR codes and files go in `public/assets/trip/` (delete the example's). Set `name`
   (the trip's title) and `short_name` (12 characters at most) in
   `public/manifest.webmanifest`: they're what the home screen shows once it's installed.
3. **Check it:** `node tools/check.mjs`. It names the file, the event and the problem. Fix the
   data and run it again until it passes. Never weaken the check to get through.
4. **Weather (optional):** `node tools/forecast.mjs` writes `public/data/forecast.json` for days
   with a `weather` place. It only forecasts ~16 days ahead; earlier, it says so and leaves the
   days out. Re-run it closer to the trip. Never hand-edit the output or fill it in yourself.
5. **Preview:** `node tools/serve.mjs`, then open `http://localhost:8080/?now=<a trip time>` to
   see any moment of the trip. If you can take screenshots, check a few moments and a few event
   sheets on a phone-sized viewport. Show the person the result.
6. **Ask before publishing.** See Permissions.

## What you may do

- **Freely:** read `bookings/`, edit `public/data/`, `public/assets/trip/` and the manifest's names, run the tools,
  preview, and commit locally.
- **Ask first:** pushing, deploying, setting up hosting, changing the engine (`public/app.js`,
  `sw.js`, `styles.css`, `index.html`), and marking the trip `shared`.
- **Never:** commit anything from `bookings/`, copy a booking document into `public/` while the
  trip is shared, or invent a fact.

## Data rules

- **The bookings win.** If the booking and your memory, a website or the user's recollection
  disagree, the document wins; say what disagrees. Never invent a time, a seat, a price, a
  platform or an address. A field you can't fill stays out.
- **Never attribute what the source doesn't.** If two tickets don't say whose is whose, the
  page says "present both", not a guess.
- **Times are what the local clock says where it happens** (`2027-04-08T09:46`), with no
  offset. The zone is the event's `timezone`, else its day's, else the trip's — all IANA
  names (`Asia/Bangkok`), never "+07:00", so daylight saving is handled for you. Give a day
  its own `timezone` when the trip moves to another zone, an event its own when it starts
  somewhere else than its day, and a flight that lands in another zone an `endTimezone`, with
  `end` the arrival time printed on the ticket. Tickets print both ends in local time: copy
  them as they are, don't convert.
- **Each event sits under its own day**, in time order. One that starts in the small hours
  (before 06:00) may stay with the day before — a 00:30 check-in, a midnight flight.
- **`local` is what the signs say:** the destination's own language and script, checked
  character by character (one wrong character and a map search finds nothing). Use the
  official name a driver or a station sign would use, not a translation.
- **A place link is the venue's own page** (or a good guide when it has none), not a booking
  page. Open every URL and check the page is that place before writing it down. Hotel chains
  have near-identical branches.
- **Coordinates (`geo`) are read back, not trusted.** Look them up (OpenStreetMap's Nominatim
  works, with a User-Agent), then check the result is the right place — searches return
  same-named places in other cities. In **mainland China** use GCJ-02 (what Google's and
  Amap's China maps use); everywhere else WGS-84. Leaving `geo` out is always better than a
  pin on the wrong place.
- **Check the date of every source.** Guides go stale: attractions close, routes change. Before
  relying on one for a walk or a timetable, search for closures and recent notices.
- **When the plan changes** on the way, update the events and put the old plan and the reason
  in a `warnings` entry, so the page and anything printed can be reconciled.
- **Drawn maps** (`image`) are drawn by you, from facts you verified — never copied from a
  website. Draw for a phone: few labels, big type (≥ 20 px in a 900-wide viewBox). Label only
  what the source names. Data from OpenStreetMap carries "© OpenStreetMap contributors".

## Privacy

The site is public to anyone with the link (`noindex` keeps it out of search engines, nothing
more). There are two modes:

- **While travelling** (`"shared": false`): QR codes (`qr`) and booking files (`files`) can be
  on the site, so they open with no signal at a gate. Copy only what the traveller needs at the
  door — the ticket image, not the whole confirmation email.
- **Shared with others** (`"shared": true`): nothing personal. `tools/check.mjs` then refuses QR
  codes, files and anything that reads like a booking number, PIN, phone number or email. It
  cannot recognise names: read every field yourself and remove travellers' and staff's names,
  passport and ID numbers, and photos showing faces or number plates. Hotel and venue names,
  business addresses and prices are fine. Delete the files from `public/assets/trip/` too.

Git history keeps everything ever committed. If personal data was committed and the repo is
public, removing it from the latest version is not enough — tell the person.

## The engine — how it works, and the rules that keep it working

- **No build step, no framework, no dependencies.** Vanilla ES modules and plain CSS;
  `public/` is deployed byte-for-byte. Node is only for the tools.
- **The app knows nothing about any one trip.** No place, date, language or name is hard-coded
  in `app.js` or `index.html`; the manifest's names are the one piece of the trip outside
  `public/data/`. A trip that needs something new gets a new
  optional field in `trip.schema.json` (with its description), read in `app.js` — in one change.
- **It's an installable PWA.** `tools/check.mjs` keeps it that way: a manifest with names,
  standalone display and 192/512 px icons, and a registered service worker. The app offers
  installation once (Chrome's own prompt, or the Share → Add to Home Screen steps on iPhone)
  and keeps an install button in the footer; once installed, neither shows.
- **Offline is the point.** `sw.js` precaches the app (`ASSETS`) plus every file `trip.json`
  names. Never make the page depend on the network to open.
- **Updates never interrupt.** A new deploy's worker installs and waits; the page offers
  "Update"; only on tap (or while the app is hidden, with nothing open) does it reload. Never
  call `skipWaiting()` on install — the reload could wipe a QR code off the screen at a gate.
  The shell is cached as `./`, never `index.html` (hosts redirect it). A launch waits at most
  3 s for the network.
- **"Now" is the latest-started event that hasn't ended**, so an activity beats the hotel stay
  around it. Once the trip is over, the page opens at day 1, nothing greyed out.
- **Not everything is tappable.** An event with nothing behind it (no details, warnings, map,
  QR, links…) is a plain row; `isRich()` in `app.js` decides. `pin: true` makes a plain row
  bold.
- **Copy is an icon next to the thing it copies**, never a word in the action row. The action
  row is for apps and files.
- **The home screen is the timeline.** Don't add bands above it; extras go in the footer.
- **Weather is hedged:** a day too far out, or where the ECMWF and GFS models disagree by more
  than 3.5 °C, is labelled an outlook. Keep that; don't make the page look more certain than
  the forecast is.
- **The app's words** are the `UI` table in `app.js`; a trip overrides them in `ui` (and date
  formats with `trip.locale`) to put the whole page in the traveller's language.

## Files

```
bookings/               the person's documents — read, never commit
public/data/trip.json   the trip                 ← you write this
public/assets/trip/     its images, QR, files    ← and this
public/manifest.webmanifest  name, short_name     ← and the home-screen name
public/data/forecast.json   generated by tools/forecast.mjs
trip.schema.json        every field, described
tools/check.mjs         run until it passes
tools/serve.mjs         local preview (?now= to time-travel)
public/app.js, sw.js, styles.css, index.html   the engine
```

## Hosting

Any static host serves `public/`. Firebase Hosting is the suggested one (free tier, fast, and
`firebase.json` is ready): `npm i -g firebase-tools`, `firebase login`, `firebase use --add`,
`firebase deploy --only hosting`. To deploy on every push, add a `FIREBASE_SERVICE_ACCOUNT`
repo secret (a service-account key) and commit `.firebaserc`; `.github/workflows/deploy.yml`
does the rest and skips quietly without them. Other hosts: point them at `public/`, no build
command. All of this is the person's call — ask before doing any of it.
