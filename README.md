# SummitLog

> **[Live demo / test it here](https://sorenselleslagh.github.io/Summit-log/)**

GitHub Pages serves the `main` branch at that address, from the `/Summit-log/` path. The link shows this version after it is merged to `main`.

A private log for mountains and climbing routes, with a map and optional partner posts. No account is required. Data stays in this browser until a later sign-up can take the same records to other devices.

## Run locally

Install and offline mode need a web server. Opening the file directly will not register a service worker.

```bash
npx serve .
```

Open the URL it prints.

To mirror GitHub Pages, serve the app under `/Summit-log/`:

```bash
mkdir -p /tmp/summit-pages
ln -s "$PWD" /tmp/summit-pages/Summit-log
python3 -m http.server 8080 --directory /tmp/summit-pages
```

Then open http://localhost:8080/Summit-log/ .

The first visit shows a short intro. **Start logging** opens the log with no sign-up. Sample peaks load when the log is empty. An optional display name is available from the header; it is not an account, and the password is not stored.

Checks for the data rules:

```bash
node test/data.test.js
```

## Intro

The first screen is one page: a mountain drawing, the line “Your climbs, your log, your partners”, three short cards, and **Start logging**. Dismissal is stored as `summitlog_intro_seen` in localStorage, so later visits open the log. Profile → About → **View intro** shows it again.

The drawing is `illustrations/mountain.svg`. Replace that file to swap in final artwork. The page inlines it.

## Install and offline

- `manifest.webmanifest` and the icons in `icons/` let the browser install SummitLog. On iPhone, use Share → Add to Home Screen. Paths are relative, so install works from `/Summit-log/` as well as from a local server root.
- `sw.js` caches the app shell (HTML, CSS, JS, icons, the intro drawing, and Leaflet) after the first online load. Logging, editing, the intro, and export/import then work with the network off.
- Map tiles are saved only after you view them. Offline, those tiles still appear. Tiles you have not opened are replaced with an “Offline” placeholder. Coming back online redraws the map.

## Stats

- **Peaks** — hiking, alpine, and ski-touring entries. Sport, trad, and ice sessions stay in the log and are not counted.
- **m elev** — elevation gain from every entry. A blank gain counts as zero; a recorded `0` stays `0`.
- **Trips** — one per calendar day with at least one entry. Two routes on the same day are one trip. The bundled sample happens to use three different days, so its trip count matches its entry count; adding a second route on an existing day does not add a trip.

Latitude and longitude of `0` are real positions and are kept. Leave both blank if you do not have a point.

## Data and a later account

The app is fully usable with no registration. Logs and partner posts live in localStorage under `summitlogs` and `partnerposts`. `storage.js` is the only module that reads and writes that storage. A future sync layer can replace that repository and keep the same load and save calls.

Every entry and partner post is stored as:

- `id` — stable UUID string. Older numeric ids and earlier string ids are rewritten once, in place, and then left alone.
- `createdAt` and `updatedAt` — ISO timestamps. Missing ones are filled on migration. Edits keep `createdAt` and refresh `updatedAt`.
- The existing fields (`name`, `type`, `date`, `elevation`, `notes`, `lat`, `lng`, and the partner-post fields) are unchanged.

Nothing is dropped in that migration: names, notes, a gain of `0`, and coordinates of `0` all remain. Import accepts the same export shape, checks that `logs` and `partnerPosts` are arrays, skips invalid records, and keeps a UUID and timestamps when the file already has them. Text is stored as text and drawn as text, so names and notes cannot inject HTML.

When accounts exist, sign-up should attach this local dataset to the account instead of starting empty. The ids and timestamps are there so sync can match records across devices. There is no account or sync in this version, and the intro does not offer one.

The display name (`summitlog_user`) is a label on this device. It does not split the log.

## Project structure

- `index.html` — intro, optional demo sign-in, log, map, partners, profile
- `style.css` — layout, including a bottom tab bar on small screens
- `app.js` — interface
- `logic.js` — stats, validation, ids, and timestamps
- `storage.js` — localStorage repository
- `sw.js` — offline cache
- `manifest.webmanifest` — install metadata
- `illustrations/mountain.svg` — intro artwork
- `favicon.ico` — browser tab icon (linked with a relative path so it loads under `/Summit-log/`)
- `icons/` — app icons and the offline map tile
- `.nojekyll` — leave GitHub Pages on plain file hosting

## Map

Ranges are drawn around a few sample areas. A check mark means a logged point falls inside that area. Suggestions under the map are sample ideas, not live search. OpenStreetMap tiles are requested only as you pan, and only those tiles are cached.
