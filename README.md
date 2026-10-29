# SummitLog

Working prototype of a digital travel log for mountains and climbing routes, with an optional partner-finding layer that uses activity history for trust context.

## Features

- Personal log of peaks and routes (private by default, stored in browser localStorage)
- Activity types: hiking, alpine, sport/trad, ice, ski touring
- Stats overview
- Interactive map (OpenStreetMap via Leaflet) showing logged peaks that have coordinates
- Full CRUD: add, edit, delete entries
- Partner objective posts that automatically include a short recent-log summary
- Export / import of all data as JSON

## Running

Open `index.html` in a modern browser. No build step required.

For a local server (optional):

```bash
npx serve .
```

## Project structure

- `index.html` — main page
- `style.css` — styles
- `app.js` — application logic
- `README.md` — this file

## Notes

This is a functional prototype. Core idea: solid private log first, then optional sharing of short log summaries to help find compatible partners. Logs provide context, not a safety guarantee.

Sample data is preloaded on first visit so you can explore immediately.
