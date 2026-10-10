# Potholes UK

Report potholes with photos, see every publicly recorded pothole in the UK on a live map, and
find out who is liable when one damages your vehicle.

- **Live map** – Leaflet + OpenStreetMap with clustering. New reports (from this site or pulled from
  upstream sources) are pushed to every open map over Server-Sent Events.
- **Reporting** – tap the map or use GPS, add severity, depth, notes and up to 4 photos. Photos are
  checked by file signature and JPEG EXIF/GPS metadata is stripped before saving. The responsible
  highway authority is looked up automatically. "Still there" confirmations build a record that the
  authority was on notice.
- **Public data** – pluggable connectors pull pothole records from FixMyStreet and from council open
  data (ArcGIS, GeoJSON, CSV – including OS grid easting/northing). See
  [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md).
- **Damage & claims guide** (`/liability`) – who is responsible for which roads in England, Wales,
  Scotland and NI; Highways Act 1980 s.41/s.58 and the Scottish and NI equivalents; how to claim;
  time limits and small-claims routes, linked to the legislation.

## Running it

Requires Node.js 22.13+ (uses the built-in `node:sqlite`, so there are no native modules to compile).

```bash
npm install
npm start            # http://localhost:3000
npm test
npm run ingest       # one-off sync of council (bulk) sources
```

| Env var | Default | |
| --- | --- | --- |
| `PORT` | `3000` | |
| `DB_FILE` | `data/potholes.db` | SQLite database |
| `UPLOAD_DIR` | `data/uploads` | Uploaded photos |
| `BULK_SYNC_HOURS` | `6` | How often council datasets are re-synced |
| `TRUST_PROXY` | – | Set (e.g. `1`) behind a reverse proxy so rate limiting sees real client IPs |
| `POSTCODES_API` | `https://api.postcodes.io` | Council lookup |
| `USER_AGENT` | `PotholesUK/0.1 (+repo url)` | Sent to upstream APIs – put a contact address in it for production |

## Layout

```
src/server.js          Express app, API routes, static files
src/db.js              SQLite schema and queries
src/live.js            Server-Sent Events hub
src/routes/reports.js  Report CRUD, photo upload
src/ingest/            FixMyStreet, ArcGIS, GeoJSON, CSV connectors + scheduler
src/lib/               OS grid → WGS84, EXIF stripping, council lookup, rate limiting
public/                Map, liability guide, data sources page
config/sources.json    External data sources
```

## Before going to production

- **Tiles:** the public OpenStreetMap tile server is fine for development but its usage policy
  doesn't allow heavy traffic – switch to a tile provider (MapTiler, Stadia, Thunderforest, or self-hosted).
- **FixMyStreet:** talk to mySociety about your expected volume and data reuse.
- **Moderation:** user reports and photos are published immediately. Add moderation/reporting of
  abuse, and consider face/number-plate blurring for photos.
- **Storage & scale:** SQLite and local disk suit one server. For multiple instances, move to
  Postgres/PostGIS, object storage for photos, and a shared store for the rate limiter and live events.
- **Legal content:** `/liability` is general information reviewed October 2026; have it checked
  by a solicitor and review it periodically.
