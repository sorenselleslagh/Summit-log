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
- `sw.js` caches the app shell (HTML, CSS, JS, icons, the intro drawing, and Leaflet) after the first online load. Logging, the backlog, and your place in a partner queue then work with the network off.
- Map tiles are saved only after you view them. Offline, those tiles still appear. Tiles you have not opened are replaced with an “Offline” placeholder. Coming back online redraws the map.

## Tabs

Bottom bar: **Log**, **Backlog**, **Map**, **Partners**. **Profile** is the header button (résumé, export, install, connections, intro).

- **Log** is home. The counts are logged peaks, routes, and hikes. The peak number is your collection.
- **Backlog** is what you want to do. **Done** moves that item to the log and keeps its fields. A route or hike linked to backlog peaks logs those peaks as well.
- **Map** draws logged items in blue and backlog items in amber. A toggle shows famous treks (Tour du Mont Blanc / UTMB, HRP, Tour du Mont Rose, GR5, GR20, and a few peaks) with **Add to backlog**. **Load peaks in this view** calls the OpenStreetMap Overpass API only when you tap it, only when zoomed in, and at most once every few seconds. Results are cached on this device. Offline, the famous list and any saved Overpass answer still work.
- **Partners** is a search for an objective: the Alpine 4000ers, your log and backlog, and the famous treks (Tour du Mont Blanc / UTMB, HRP, Tour du Mont Rose, GR5, GR20). Open one to see its queue. **Join the queue** can include rough dates, a short note, and log entries, and nothing is attached until you tick it. **Find partners** on a backlog item opens that objective. Your place is stored on this device (`summitlog_queues`). Other people in a queue are sample profiles with a Demo badge, not real users. Being visible to other people needs an account, which does not exist yet. There is no ranking.

No pace, speed, ranking, or leaderboard is shown. There is no file import.

## Item model

One log (`summitlogs`) and one backlog (`summitbacklog`). Every item is a peak, a route, or a hike. The form is one short card; the kind changes the hints.

- **Peak** — name, summit elevation, map pin.
- **Route** — name, grade, crag or mountain, activity (sport, trad, bouldering, alpine, ice, mixed, ski). The grade hint follows the activity (Font, French, AD/PD, and so on).
- **Hike** — name, distance, elevation gain, optional track note, map pin.

Routes and hikes can link to peaks. Each record keeps a stable UUID `id` plus `createdAt` and `updatedAt`. Older entries that only had an activity type are migrated in place: alpine and peak-bagging names become peaks, sport, trad, ice, and mixed become routes, ski tours become hikes. An id or timestamp that is already stored is kept. A coordinate of `0` stays `0`.

Text is stored as text and drawn as text.

The display name (`summitlog_user`) is a label on this device. It does not split the log. `storage.js` is the only module that reads and writes this storage.

## Collections

`data/collections/uiaa-alps-4000.json` is the UIAA list of 82 Alpine 4000ers (1994), grouped by country and sub-range. Another range is another object in `collections`, so the file can grow later. The Pyrenees are not included yet.

Elevations, countries, and sub-ranges come from the Wikipedia table [List of mountains of the Alps over 4000 metres](https://en.wikipedia.org/wiki/List_of_mountains_of_the_Alps_over_4000_metres) (CC BY-SA 4.0), which reproduces the UIAA list. Coordinates are Wikidata P625 (CC0).

Each peak’s normal-route **grade** and the **route name** it applies to come from [Camptocamp](https://www.camptocamp.org) (content CC BY-SA), using the summit waypoint and the easiest alpine route, preferring one titled as the voie normale. The `sourceUrl` is that route’s Camptocamp page. Grades use the alpine scale (F, PD-, PD, PD+, AD-, AD, AD+, D, TD, and the same with +/−). Where that choice differs from the Wikipedia table, the peak’s `sourceNote` says so and Camptocamp’s grade is the one stored. Mont Blanc de Courmayeur is the exception: Camptocamp does not list the short continuation from Mont Blanc, so its grade is the Wikipedia table’s PD- to PD+, stored as PD+.

Gear is not stored or shown.

All **82** peaks have a sourced grade. None are unknown.

Ticking a peak logs it as a Peak (or links the log entry you already have, matched by that collection id or by name, so Matterhorn and Matterhorn (Hörnli) are one summit). A logged route or hike that points at that log entry ticks the same box. Progress such as `2/82` is only yours. There is no leaderboard.

On a peak, **Build up to this peak** suggests a few lower summits in the same area, using only elevation, region, and grade when those fields exist. Your level is the highest elevation and the hardest sourced grade among peaks you have logged. Glacier experience is set only if you say so in Profile, or when a logged peak’s cited route name actually contains the word glacier. You can override the estimate under Profile → Your level. If a grade were missing, the note would say so instead of inventing one.

## Roadmap

Not built yet:

- **Accounts and sync.** Signing up should attach this log, backlog, and queue places to the account without dropping or rewriting ids. A sync layer would replace `storage.js` and use `updatedAt` when two devices both have changes. Joining a partner queue for real needs that account. Until then, sample people stay marked Demo and your own place stays on this device.
- **Connections.** Profile lists Strava, Garmin Connect, and COROS as coming soon. They need an account.
- **Camptocamp** is the likely source for alpine route detail later. It is not connected. Famous hikes here are a short built-in list; extra peaks come from Overpass when you ask.

## Project structure

- `index.html` — intro, optional demo sign-in, log, backlog, map, partners, profile
- `style.css` — layout, with the four tabs on the bottom
- `app.js` — interface
- `logic.js` — item model, stats, validation, ids, and timestamps
- `partners.js` — objective search and queue records, including the sample Demo profiles
- `overpass.js` — polite OpenStreetMap peak requests
- `storage.js` — localStorage repository (`summitlog_queues` holds the places you joined)
- `sw.js` — offline cache
- `manifest.webmanifest` — install metadata
- `illustrations/mountain.svg` — intro artwork
- `favicon.ico` — browser tab icon (linked with a relative path so it loads under `/Summit-log/`)
- `icons/` — app icons and the offline map tile
- `.nojekyll` — leave GitHub Pages on plain file hosting

## Map

Ranges are drawn around a few sample areas. A check mark means a logged point falls inside that area. OpenStreetMap tiles are requested only as you pan, and only those tiles are cached. The famous-route list does not download tiles by itself.
