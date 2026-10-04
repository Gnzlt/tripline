# <img src="docs/logo.svg" alt="tripline" width="280">

**Hand your bookings to your AI agent and get an offline trip app you can install on your phone.**

<p>
  <img src="docs/timeline.png" width="200" alt="The timeline, showing what's happening right now">
  <img src="docs/sheet.png" width="200" alt="An event's details: place, times, warnings, directions">
  <img src="docs/qr.png" width="200" alt="A booked event with its entry QR code, ready to show at the door">
  <img src="docs/driver.png" width="200" alt="A card in the local language to show a driver">
</p>

tripline turns your bookings into a small app (a PWA) that you install from the browser
onto your phone. It opens from your home screen, instantly, even with no signal. It shows what's happening now and what's next, with a countdown. Tap any event for its
details:

- addresses in the local script, ready to copy;
- seats and warnings;
- a Maps button;
- a card to show the driver;
- your QR codes and tickets.

You don't write any of it. Your AI agent (Claude, ChatGPT/Codex, Gemini, Cursor, Copilot…)
reads your bookings and builds the trip. [`AGENTS.md`](AGENTS.md) teaches it how.

## How it works

1. **Use this template** (the green button above) to get your own copy, and open it with your
   AI agent.
2. **Drop your bookings in [`bookings/`](bookings/):** confirmation PDFs, e-tickets, emails,
   screenshots. That folder is never committed.
3. **Ask your agent:**
   > Read AGENTS.md, then build my trip from everything in bookings/.
4. **Preview it** with `node tools/serve.mjs`. Add `?now=2027-04-09T07:00` to the URL to see any
   moment of the trip.
5. **Deploy it** (below), install it on your phone, and go.

## Features

- **Installable and offline.** It's a PWA: install it once and it works like an app, with no
  signal, no app store and no account. Updates never interrupt you.
- **Now and next.** It shows the current event, the next one, a countdown, and the progress of
  the day and the trip.
- **Local language.** Place names come in the local script, and the driver card goes fullscreen
  with a copy button.
- **Maps, links and files.** It has Google Maps buttons, live links (delays, webcams), and QR
  codes and tickets for the gate.
- **Weather.** It takes a baked-in forecast for each day, with an altitude correction for summit
  days.
- **Any language.** The app's own words and date formats can be changed per trip.
- **Shareable.** `"shared": true` makes the checks refuse anything personal before you send the
  link to family.

There's no build step, no framework and no dependencies. The whole trip lives in one JSON file,
[`public/data/trip.json`](public/data/trip.json), described by
[`trip.schema.json`](trip.schema.json) and checked by `node tools/check.mjs`. The example trip
is three days in Kansai.

## Install it on your phone

Open your trip's link on the phone, then:

- **iPhone or iPad (Safari):** tap Share, then **Add to Home Screen**.
- **Android (Chrome):** tap **Install** when the app offers it, or use the menu: **Install app**.
- **Desktop (Chrome, Edge):** use the install icon in the address bar.

The app offers this once by itself, and there's always an **Install as an app** button at the
bottom of the timeline. Once installed, it opens from the home screen as an app, and it keeps
working with no signal.

## Hosting

`public/` is a static site, so any static host works.

**[Firebase Hosting](https://firebase.google.com/docs/hosting)** is the suggested option. Its
free tier is plenty, and `firebase.json` is ready:

```sh
npm install -g firebase-tools
firebase login
firebase use --add            # pick or create a project
firebase deploy --only hosting
```

To deploy on every push, add a `FIREBASE_SERVICE_ACCOUNT` repo secret (a service-account JSON
key) and commit `.firebaserc`. Until both exist, the workflow only runs the checks.

**Anywhere else** (GitHub Pages, Netlify, Cloudflare Pages, your own server): publish the
`public/` folder as it is, with no build command.

## Privacy

The site is public to anyone with the link. It carries `noindex`, so search engines skip it, but
it is not private. While you travel, keep it to yourself. Before sharing it, set
`"shared": true` and let your agent clean it up. Your `bookings/` folder never leaves your
machine through git.

## License

[MIT](LICENSE)
