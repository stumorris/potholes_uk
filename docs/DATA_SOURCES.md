# Adding public pothole data

There is no single national register of potholes in the UK. Records are held by
~200 separate highway authorities, and only some of them publish it. This app
pulls from every source configured in [`config/sources.json`](../config/sources.json).

## Built-in

| Source | How | Notes |
| --- | --- | --- |
| **FixMyStreet** (mySociety) | On demand, per ~5 km map tile, when someone zooms in to street level. Cached for 15 minutes per tile. | The biggest public source of pothole reports across England, Wales, Scotland and NI. Category names differ by council, so `categories` lists the common ones – extend it if a council uses another name. Be a polite client: don't lower the cache TTL, and contact mySociety before running this at scale (they offer commercial data access). |
| **Reports made on this site** | Live. | Photos have EXIF/GPS metadata stripped. |

## Adding a council

1. **Find the data.** Good places to look:
   - [data.gov.uk](https://www.data.gov.uk/) – search "potholes", "highway defects", "carriageway repairs".
   - The council's own open data portal; many run on ArcGIS Hub (`*.hub.arcgis.com`), CKAN, Socrata or DataMill North.
   - The council's highway maintenance transparency report.
   - If nothing is published, a Freedom of Information request (e.g. via
     [WhatDoTheyKnow](https://www.whatdotheyknow.com/)) for "all carriageway pothole/defect
     reports and repairs with location, date and status". Host the CSV it returns and point a
     `csv` source at it.
2. **Check the licence.** Most council data is under the Open Government Licence v3.0, which
   allows reuse with attribution. Put the attribution string in the source config – it's shown on
   the Data sources page.
3. **Add an entry** to `config/sources.json` and set `"enabled": true`.

### Source types

| `type` | `url` points at | Location from |
| --- | --- | --- |
| `arcgis` | An ArcGIS FeatureServer/MapServer **layer** (ends in `/0`, `/1`, …). Paged automatically; use `where` to select potholes server-side. | Geometry (requested in WGS84) |
| `geojson` | A GeoJSON FeatureCollection | Point geometry. British National Grid coordinates are detected and converted. |
| `csv` | A CSV file | `fields.lat` + `fields.lng`, **or** `fields.easting` + `fields.northing` (OS grid, converted to WGS84) |

### Field mapping

```jsonc
"fields": {
  "id": "OBJECTID",          // required – a stable unique id in the dataset
  "title": "STREET",         // shown on the map
  "description": "DETAILS",
  "status": "STATUS",        // mapped with statusMap; anything containing fixed/repaired/complete/closed = fixed
  "reportedAt": "DATE",      // ISO, epoch ms, or DD/MM/YYYY
  "url": "LINK",             // or use "recordUrl": "https://…/{id}" at the source level
  "lat": "LAT", "lng": "LON" // or "easting"/"northing"
},
"statusMap": { "Job Complete": "fixed", "Not Our Responsibility": "closed" },
"filter": { "field": "DEFECT_TYPE", "contains": ["pothole"] }   // or "values": [...] for exact matches
```

Run `npm run ingest` to sync bulk sources once and print what was imported. The server also
re-syncs them every `BULK_SYNC_HOURS` (default 6).
