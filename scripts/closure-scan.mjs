// Report-only scan: which places on the map look closed, and which new restaurants/bars inside the Loop are missing.
// Uses three Texas Comptroller open datasets (data.texas.gov):
//   3kx8-uryv  All permitted sales-tax locations (active in the last 4 years; closed outlets carry an out-of-business date)
//   naix-2893  Mixed-beverage gross receipts (every bar/restaurant with a liquor permit files monthly)
//   jrea-zgmq  Active sales-tax permit holders (NAICS code + first-sales date → new openings)
// Writes data/closure-report.json and changes nothing else. Run in GitHub Actions (data.texas.gov is reachable there).
import fs from 'fs';
const P = JSON.parse(fs.readFileSync('public/places.json', 'utf8')).places;
const O = JSON.parse(fs.readFileSync('public/overrides.json', 'utf8')).spots;
const ZIPS = '77002 77003 77004 77005 77006 77007 77008 77009 77010 77011 77012 77019 77020 77021 77023 77025 77026 77027 77030 77046 77054 77056 77057 77081 77087 77096 77098 77401'.split(' ');
const report = { at: new Date().toISOString(), notes: [] };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function soql(ds, params) {
  const url = `https://data.texas.gov/resource/${ds}.json?` + new URLSearchParams(params);
  for (let a = 0; a < 3; a++) {
    try { const r = await fetch(url, { signal: AbortSignal.timeout(180000) }); const j = await r.json(); if (Array.isArray(j)) return j; report.notes.push(`${ds}: ${JSON.stringify(j).slice(0, 300)}`); return []; } catch (e) { report.notes.push(`${ds} try ${a}: ${e}`); await sleep(3000); }
  }
  return [];
}
async function all(ds, where, extra = {}) {
  const out = []; for (let off = 0; off < 400000; off += 50000) { const rows = await soql(ds, { $where: where, $limit: '50000', $offset: String(off), ...extra }); out.push(...rows); if (rows.length < 50000) break; } return out;
}
const field = (keys, ...res) => keys.find((k) => res.every((re) => re.test(k)));

// ---------- matching helpers ----------
const GEN = /\b(the|houston|htx|bar|lounge|restaurant|restaurants|kitchen|and|grill|cafe|co|company|tx|texas|llc|inc|ltd|lp|corp|of|at|on|in|a|st|street|dba)\b/g;
const words = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, '').replace(/&/g, ' and ').replace(GEN, ' ').replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length >= 3);
const compact = (s) => words(s).join('');
const nameLike = (a, b) => { const A = words(a), B = words(b), ca = A.join(''), cb = B.join(''); if (!ca || !cb) return false; if (ca === cb || (ca.length >= 5 && cb.includes(ca)) || (cb.length >= 5 && ca.includes(cb))) return true; return A.some((w) => w.length >= 4 && B.includes(w)); };
const addrKey = (a) => { const m = String(a || '').toLowerCase().replace(/\b(north|south|east|west)\b/g, (x) => x[0]).match(/^\s*(\d+)\s+(?:[nsew]\.?\s+)?([a-z0-9]+)/); return m ? m[1] + ' ' + m[2] : ''; };
const fixOf = (p) => O[p.name + '|' + ((p.address || '').match(/^\d+/) || [''])[0]] || O[p.name] || {};
const places = P.map((p) => { const f = fixOf(p); return { name: p.name, addr: f.street || p.address || '', key: addrKey(f.street || p.address), closed: f.status === 'closed' }; }).filter((p) => !p.closed);

// ---------- 1. sales-tax locations, open and closed ----------
const s1 = await soql('3kx8-uryv', { $limit: '1' }); const k1 = Object.keys(s1[0] || {}); report.salesTaxFields = k1;
const zipF = field(k1, /outlet/, /zip/) || field(k1, /zip/), addrF = field(k1, /outlet/, /address/) || field(k1, /address/), nameF = field(k1, /outlet/, /name/) || field(k1, /name/), oobF = field(k1, /out/, /bus/) || field(k1, /end/, /date/), cityF = field(k1, /outlet/, /city/) || field(k1, /city/), naicsF = field(k1, /naics/), taxF = field(k1, /taxpayer/, /name/);
report.salesTaxPicked = { zipF, addrF, nameF, oobF, cityF, naicsF, taxF };
const byKey = new Map();
if (zipF && addrF && nameF) {
  for (const z of ZIPS) {
    let where = `starts_with(${zipF}, '${z}')`; if (naicsF && typeof s1[0][naicsF] === 'string') where += ` AND starts_with(${naicsF}, '72')`;
    const rows = await all('3kx8-uryv', where); report[`st_${z}`] = rows.length;
    for (const r of rows) { const k = addrKey(r[addrF]); if (!k) continue; (byKey.get(k) || byKey.set(k, []).get(k)).push({ n: r[nameF], t: taxF ? r[taxF] : '', oob: oobF ? r[oobF] || '' : '', naics: naicsF ? r[naicsF] : '' }); }
  }
}
report.salesTaxAddresses = byKey.size;

// ---------- 2. liquor filings, last 26 months ----------
const since = new Date(Date.now() - 790 * 864e5).toISOString().slice(0, 10) + 'T00:00:00';
const mb = await all('naix-2893', `upper(location_city)='HOUSTON' AND obligation_end_date_yyyymmdd >= '${since}'`, { $select: 'location_name,taxpayer_name,location_address,location_zip,obligation_end_date_yyyymmdd,total_receipts,tabc_permit_number' });
report.liquorRows = mb.length;
const latestMonth = mb.reduce((m, r) => (r.obligation_end_date_yyyymmdd > m ? r.obligation_end_date_yyyymmdd : m), '');
report.liquorLatestMonth = latestMonth;
const permits = new Map();
for (const r of mb) { const id = r.tabc_permit_number || r.location_name + r.location_address; const e = permits.get(id) || { n: r.location_name, t: r.taxpayer_name, key: addrKey(r.location_address), last: '', lastPaid: '' }; if (r.obligation_end_date_yyyymmdd > e.last) e.last = r.obligation_end_date_yyyymmdd; if (+r.total_receipts > 500 && r.obligation_end_date_yyyymmdd > e.lastPaid) e.lastPaid = r.obligation_end_date_yyyymmdd; permits.set(id, e); }
const permByKey = new Map(); for (const e of permits.values()) if (e.key) (permByKey.get(e.key) || permByKey.set(e.key, []).get(e.key)).push(e);
const monthsBefore = (d, n) => { const x = new Date(d); x.setMonth(x.getMonth() - n); return x.toISOString(); };
const stale = latestMonth ? monthsBefore(latestMonth, 3) : '';

// ---------- 3. verdict per place ----------
const out = { closedSalesTax: [], liquorStopped: [], confirmedOpen: 0, unknown: 0 };
for (const p of places) {
  const st = (byKey.get(p.key) || []).filter((o) => nameLike(p.name, o.n) || nameLike(p.name, o.t));
  const lq = (permByKey.get(p.key) || []).filter((o) => nameLike(p.name, o.n) || nameLike(p.name, o.t));
  const stOpen = st.some((o) => !o.oob), stClosed = st.length && !stOpen;
  const lqOpen = lq.some((o) => (o.lastPaid || o.last) >= stale), lqStopped = lq.length && !lqOpen;
  if (stClosed && !lqOpen) out.closedSalesTax.push({ name: p.name, addr: p.addr, outOfBusiness: st.map((o) => String(o.oob).slice(0, 10)).sort().pop(), outlet: st[0].n, liquorStopped: !!lqStopped });
  else if (lqStopped && !stOpen) out.liquorStopped.push({ name: p.name, addr: p.addr, lastFiling: lq.map((o) => (o.lastPaid || o.last).slice(0, 10)).sort().pop(), permit: lq[0].n });
  else if (stOpen || lqOpen) out.confirmedOpen++;
  else out.unknown++;
}
report.places = places.length; Object.assign(report, out);

// ---------- 4. new food & drink outlets not on the map ----------
const s3 = await soql('jrea-zgmq', { $limit: '1' }); const k3 = Object.keys(s3[0] || {}); report.activeFields = k3;
const z3 = field(k3, /outlet/, /zip/), a3 = field(k3, /outlet/, /address/), n3 = field(k3, /outlet/, /name/), nc3 = field(k3, /naics/), fs3 = field(k3, /first/, /sale/), c3 = field(k3, /outlet/, /city/);
const cutoff = new Date(Date.now() - 600 * 864e5).toISOString().slice(0, 10);
const NEWOK = /^(722511|722513|722410|722515|722514)/;
const fresh = [];
if (z3 && a3 && n3 && nc3) {
  for (const z of ZIPS) {
    const rows = await all('jrea-zgmq', `starts_with(${z3}, '${z}') AND starts_with(${nc3}, '722')`); report[`act_${z}`] = rows.length;
    for (const r of rows) {
      if (!NEWOK.test(String(r[nc3]))) continue; const first = fs3 ? String(r[fs3] || '').slice(0, 10) : ''; if (fs3 && first && first < cutoff) continue;
      const nm = r[n3], k = addrKey(r[a3]); if (!k || !words(nm).length) continue;
      if (places.some((p) => nameLike(p.name, nm) && (p.key === k || compact(p.name) === compact(nm)))) continue;
      fresh.push({ name: nm, addr: r[a3], zip: String(r[z3]).slice(0, 5), naics: r[nc3], first });
    }
  }
}
const seen = new Set(); report.newCandidates = fresh.filter((f) => { const k = compact(f.name) + addrKey(f.addr); if (seen.has(k)) return false; seen.add(k); return true; }).sort((a, b) => (b.first || '').localeCompare(a.first || '')).slice(0, 900);
fs.mkdirSync('data', { recursive: true }); fs.writeFileSync('data/closure-report.json', JSON.stringify(report, null, 1));
console.log(JSON.stringify({ places: report.places, closedSalesTax: out.closedSalesTax.length, liquorStopped: out.liquorStopped.length, confirmedOpen: out.confirmedOpen, unknown: out.unknown, newCandidates: report.newCandidates.length, notes: report.notes.slice(0, 5) }));
