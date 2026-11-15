// Copies runtime assets that bundlers cannot discover: the MapLibre web worker and the
// province boundaries exported by api/export_static.py. Runs before dev and build.
import { copyFileSync, mkdirSync } from 'node:fs'
mkdirSync('public/vendor', { recursive: true })
mkdirSync('public/data', { recursive: true })
copyFileSync('node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs', 'public/vendor/maplibre-gl-worker.mjs')
copyFileSync('content/data/regions.geojson', 'public/data/regions.geojson')
console.log('assets copied')
