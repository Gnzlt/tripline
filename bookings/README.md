# bookings/

Put everything about your trip here: booking confirmations (PDF), e-tickets, emails,
screenshots, notes. Your AI agent reads this folder to build the trip.

**Nothing in this folder is ever committed or deployed** — `.gitignore` keeps it out of git,
and `node tools/check.mjs` fails if anything here is tracked. Your trip site only ever gets
what the agent writes into `public/`.
