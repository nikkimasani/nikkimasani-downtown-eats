// The neighbourhoods around the mapped districts — houses, townhomes, small apartment blocks — so the map isn't empty
// between EaDo, Midtown, the Fourth Ward, Washington Ave and the Heights. Written as compact tiles to public/homes.json,
// which the map loads after it opens and draws only where you're looking. Run: node scripts/osm-homes.mjs (Node 20+).
// Map data © OpenStreetMap contributors, ODbL.
import fs from 'fs';
// the full detail boxes (scripts/osm-buildings.mjs); anything inside them is already drawn, except the Heights' houses
const BOXES = [[29.7380, -95.3790, 29.7715, -95.3100], [29.7580, -95.3480, 29.7740, -95.3200], [29.7640, -95.3860, 29.7735, -95.3760], [29.7675, -95.4000, 29.7725, -95.3950], [29.7540, -95.4130, 29.7650, -95.3770], [29.7310, -95.3890, 29.7480, -95.3600]];
// where to fill: the ring of neighbourhoods around them (Fourth Ward, Montrose north, Rice Military, Sixth Ward, Midtown/Third Ward edge, Fifth Ward edge) and the Heights
const FILL = [[29.7300, -95.4150, 29.7745, -95.3100], [29.7745, -95.4200, 29.8100, -95.3850]];
const HEIGHTS = FILL[1];
const T = 0.004;   // tile size in degrees (~440 m)
const Q = `[out:json][timeout:180];(${FILL.map((B) => `way["building"](${B});`).join('')});out tags geom;`;
const EP = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
let data = null;
for (let round = 0; round < 3 && !data; round++) for (const ep of EP) {
  if (data) break; if (round) await new Promise((r) => setTimeout(r, 20000));
  try { const r = await fetch(ep, { method: 'POST', body: 'data=' + encodeURIComponent(Q), headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'downtown-eats (personal dining app)' } }); if (r.ok) data = await r.json(); } catch (e) {}
}
if (!data) { console.error('Overpass unavailable; keeping the existing homes.json'); process.exit(0); }
const inBox = (la, ln, B) => la > B[0] && la < B[2] && ln > B[1] && ln < B[3];
const M_LAT = 110850, M_LNG = 96680;
const area = (r) => { let s = 0; for (let i = 0; i < r.length - 1; i++) s += r[i][1] * M_LNG * r[i + 1][0] * M_LAT - r[i + 1][1] * M_LNG * r[i][0] * M_LAT; return Math.abs(s / 2); };
const HOMES = /^(house|houses|residential|detached|semidetached_house|terrace|bungalow|apartments|dormitory)$/;
const SMALL = /^(garage|garages|shed|carport|roof|hut|greenhouse)$/;
// the same rule osm-buildings.mjs uses to decide what the Heights keeps; everything it drops comes here
const keptInHeights = (t, a) => t.name || t.amenity || t.shop || (!HOMES.test(t.building || '') && !SMALL.test(t.building || '') && (/^(commercial|retail|office|industrial|warehouse|church|school|civic|public|hotel|supermarket)$/.test(t.building || '') || a >= 450));
const tiles = {}; let n = 0;
for (const el of data.elements) {
  if (el.type !== 'way' || !el.geometry || el.geometry.length < 4) continue;
  const t = el.tags || {}, ring = el.geometry.map((g) => [g.lat, g.lon]), a = area(ring); if (a < 25) continue;
  const c = ring.slice(0, -1).reduce((s, p) => [s[0] + p[0] / (ring.length - 1), s[1] + p[1] / (ring.length - 1)], [0, 0]);
  const heights = inBox(c[0], c[1], HEIGHTS) && c[0] > 29.7745;
  if (heights ? keptInHeights(t, a) : BOXES.some((B) => inBox(c[0], c[1], B))) continue;   // already drawn by buildings.json
  if (SMALL.test(t.building || '') && a < 60) continue;   // sheds
  const lv = +t['building:levels'] || 0, hM = +String(t.height || '').replace(/[^\d.]/g, '') || (lv ? lv * 3.2 : 0);
  // kind: h house / townhome, a apartments, g garage, w warehouse or shop, c church
  const b = t.building || 'yes', kind = /church|chapel/.test(b) || t.amenity === 'place_of_worship' ? 'c' : /garage|shed|carport/.test(b) ? 'g'
    : /apartments|dormitory/.test(b) || a > 900 ? 'a' : /warehouse|industrial|commercial|retail|office/.test(b) || t.shop ? 'w' : 'h';
  // compact ring: first point, then offsets in 1e-5 degrees (~1 m), dropping the closing point
  const p0 = [Math.round(ring[0][0] * 1e5), Math.round(ring[0][1] * 1e5)], off = [];
  for (const [la, ln] of ring.slice(1, -1)) off.push(Math.round(la * 1e5) - p0[0], Math.round(ln * 1e5) - p0[1]);
  const key = Math.floor(c[0] / T) + ',' + Math.floor(c[1] / T);
  (tiles[key] ||= []).push([kind, Math.round(hM * 10) / 10 || 0, p0[0], p0[1], ...off]); n++;
}
fs.writeFileSync('public/homes.json', JSON.stringify({ tile: T, attribution: 'Map data © OpenStreetMap contributors, ODbL', tiles }));
console.log('homes', n, 'tiles', Object.keys(tiles).length);
