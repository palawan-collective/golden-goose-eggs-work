// TREs KML -> SANVIC.PH enrichment importer.
// Default: DRY RUN (no writes to DB or Storage). Use --apply to write.
// Scratch image library lives outside the repo; no package.json changes.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'scripts', 'out');
fs.mkdirSync(OUT, { recursive: true });
const STATE_FILE = path.join(OUT, 'imported-images.json');
let importedState = {};
try { importedState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch {}

const KML = process.env.TRE_KML || 'C:/Users/growp/Downloads/TREs San Vicente, Palawan.kml';
const SHARP_DIR = process.env.SHARP_DIR || 'C:/Users/growp/AppData/Local/Temp/opencode/tres-img';
const cfg = fs.readFileSync(path.join(ROOT, 'public/site/supabase-config.js'), 'utf8');
const URL_BASE = (cfg.match(/const SUPABASE_URL\s*=\s*"([^"]+)"/) || [])[1];
const KEY = (cfg.match(/const SUPABASE_ANON_KEY\s*=\s*"([^"]+)"/) || [])[1];
if (!URL_BASE || !KEY) throw new Error('Supabase config not found');
const BUCKET = 'destination-images';
const CREDIT = 'Photo: Municipal Tourism Office, San Vicente';
const MAX_IMAGES_PER_PLACE = 8;
const MAX_WIDTH = 1600;
const TARGET_BYTES = 250 * 1024;

const APPLY = process.argv.includes('--apply');
const onlyArg = process.argv.find((a) => a.startsWith('--only='));
const ONLY = onlyArg ? onlyArg.slice(7).split('|').map((s) => s.trim()).filter(Boolean) : null;

const headers = { apikey: KEY, Authorization: 'Bearer ' + KEY };
const api = async (table, query = '') => {
  const r = await fetch(`${URL_BASE}/rest/v1/${table}${query}`, { headers });
  if (!r.ok) throw new Error(`${table} ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return r.json();
};
const patch = async (table, query, body, prefer = 'return=representation') => {
  const r = await fetch(`${URL_BASE}/rest/v1/${table}${query}`, {
    method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json', Prefer: prefer }, body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`PATCH ${table} ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return prefer.includes('representation') ? r.json() : null;
};
const post = async (table, body) => {
  const r = await fetch(`${URL_BASE}/rest/v1/${table}`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`POST ${table} ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return r.json();
};

const decode = (s) => String(s || '')
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<')
  .replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/&#x27;/gi, "'");
const grab = (b, t) => { const m = b.match(new RegExp('<' + t + '>([\\s\\S]*?)</' + t + '>', 'i')); return m ? decode(m[1]).trim() : ''; };
const PHONE_RE = /(?:\+?63|0)?9\d{2}[\s\-.]?\d{3}[\s\-.]?\d{4}/g;
const digits = (s) => String(s || '').replace(/\D/g, '');
const normName = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

function cleanDescription(raw) {
  let t = String(raw || '');
  t = t.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n').replace(/<[^>]+>/g, '');
  t = decode(t);
  t = t.replace(/\bdescription:\s*/gi, '');
  t = t.replace(/\bid:\s*\d*\s*/gi, '');
  t = t.replace(/Contact\s*(?:No|Number|#)?\s*:\s*/gi, '');
  t = t.replace(PHONE_RE, '');
  t = t.replace(/https?:\/\/\S+/gi, '');
  return t.split(/[\r\n]+/).map((x) => x.trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}
function imageUrls(raw) {
  return [...new Set([...String(raw || '').matchAll(/<img[^>]+src\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]))];
}
function barangayFor(folder, name, desc) {
  const hay = (folder + ' ' + name + ' ' + desc).toLowerCase().replace(/[_-]+/g, ' ');
  const map = [
    ['Port Barton', ['port barton', 'portbarton']],
    ['Poblacion', ['poblacion', 'pob.']],
    ['New Agutaya', ['new agutaya', 'agutaya']],
    ['Sto. Niño', ['sto nino', 'santo nino', 'sto. niño', 'santo niño']],
    ['San Isidro', ['san isidro']],
    ['Alimanguan', ['alimanguan']],
    ['Binga', ['binga']],
  ];
  for (const [b, hints] of map) if (hints.some((h) => hay.includes(h))) return b;
  return '';
}

// --- KML parse (no external XML parser) ---
const xml = fs.readFileSync(KML, 'utf8');
const tokens = [...xml.matchAll(/<(\/?)Folder>|<(\/?)Placemark>/gi)].map((m) => ({
  kind: m[1] ? 'closeFolder' : m[2] ? 'closePlacemark' : m[0].toLowerCase() === '<folder>' ? 'openFolder' : 'openPlacemark',
  index: m.index, full: m[0],
}));
const stack = [], blocks = []; let cur = null;
for (const t of tokens) {
  if (t.kind === 'openFolder') stack.push(grab(xml.slice(t.index, t.index + 500), 'name') || '?');
  else if (t.kind === 'closeFolder') stack.pop();
  else if (t.kind === 'openPlacemark') cur = { folder: stack.join(' / '), start: t.index + t.full.length };
  else if (t.kind === 'closePlacemark' && cur) { cur.block = xml.slice(cur.start, t.index); blocks.push(cur); cur = null; }
}
const kmlPlaces = blocks.map((p) => {
  const b = p.block;
  if (!/<Point>/i.test(b)) return null;
  const c = (b.match(/<coordinates>([^<]+)<\/coordinates>/i) || [])[1] || '';
  const [lng, lat] = c.split(',').map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const rawDesc = grab(b, 'description');
  const ext = [...b.matchAll(/<Data\s+name="([^"]+)">\s*<value>([\s\S]*?)<\/value>/gi)].map((m) => [m[1], decode(m[2])]);
  const extText = ext.map((x) => x[1]).join(' ');
  const allText = rawDesc + ' ' + extText;
  const phones = [...new Set((allText.match(PHONE_RE) || []).map((x) => x.trim()))];
  const rawImages = imageUrls(allText);
  const name = grab(b, 'name');
  return {
    name, lat, lng, folder: p.folder, rawDescription: rawDesc,
    description: cleanDescription(rawDesc),
    barangay: barangayFor(p.folder, name, rawDesc),
    phones, images: rawImages,
  };
}).filter(Boolean);

const hav = (a, b, c, d) => {
  const R = 6371000, q = Math.PI / 180;
  const dLat = (c - a) * q, dLng = (d - b) * q;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a * q) * Math.cos(c * q) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(x)));
};

// --- live DB read ---
const destinations = await api('destinations', '?select=id,name,lat,lng,status,description,barangay,image,images,image_credit,category,color,sort_order,featured&limit=1000');
const contacts = await api('place_contacts', '?select=id,place_id,kind,value,sort_order&limit=2000');
const byName = new Map();
for (const d of destinations) { const k = normName(d.name); if (!byName.has(k)) byName.set(k, []); byName.get(k).push(d); }
const contactsByPlace = new Map();
for (const c of contacts) { if (!contactsByPlace.has(c.place_id)) contactsByPlace.set(c.place_id, []); contactsByPlace.get(c.place_id).push(c); }

const exact = [], review = [];
for (const k of kmlPlaces) {
  const named = byName.get(normName(k.name)) || [];
  if (named.length === 1) exact.push({ kml: k, db: named[0] });
  else {
    const cands = destinations.filter((d) => Number.isFinite(d.lat) && Number.isFinite(d.lng))
      .map((d) => ({ d, m: hav(k.lat, k.lng, Number(d.lat), Number(d.lng)) }))
      .filter((x) => x.m < 75).sort((a, b) => a.m - b.m);
    review.push({
      kmlName: k.name, folder: k.folder, lat: k.lat, lng: k.lng,
      reason: named.length > 1 ? 'duplicate normalized name' : (cands.length ? 'distance-only' : 'no candidate'),
      candidates: cands.slice(0, 8).map((x) => ({ id: x.d.id, name: x.d.name, metres: x.m })),
      wouldAttach: { description: k.description.slice(0, 160), barangay: k.barangay, phones: k.phones, images: k.images.length },
    });
  }
}

let selected = exact;
if (ONLY) {
  const set = new Set(ONLY.map(normName));
  selected = exact.filter((x) => set.has(normName(x.kml.name)));
}

// --- compute changes / conflicts ---
const changes = [], conflicts = [];
for (const { kml, db } of selected) {
  if (!db) continue;
  const existingImages = Array.isArray(db.images) ? db.images.filter(Boolean) : [];
  const existingPhones = new Set((contactsByPlace.get(db.id) || []).filter((c) => c.kind === 'phone').map((c) => digits(c.value)));
  const alreadyImported = importedState[db.id] || [];
  const newImages = kml.images.filter((u) => !existingImages.includes(u) && !alreadyImported.includes(u)).slice(0, MAX_IMAGES_PER_PLACE);
  // Phase 2: a place with no KML photos is left completely unchanged.
  if (!newImages.length) continue;
  const newPhones = kml.phones.filter((p) => !existingPhones.has(digits(p)));
  const empty = (v) => v == null || String(v).trim() === '' || (Array.isArray(v) && v.length === 0);
  const coverMode = empty(db.image) && existingImages.length === 0 ? 'empty-cover' : 'replace';
  const patchFields = {};
  if (empty(db.barangay) && kml.barangay) patchFields.barangay = kml.barangay;
  patchFields.image = '__FIRST_NEW_IMAGE__';
  patchFields.images = newImages.map(() => '__NEW_IMAGE__');
  if (empty(db.image_credit)) patchFields.image_credit = CREDIT;
  const conflictFields = {};
  if (kml.description && !empty(db.description) && kml.description !== String(db.description).trim()) conflictFields.description = { existing: String(db.description).slice(0, 200), kml: kml.description.slice(0, 200) };
  if (kml.barangay && !empty(db.barangay) && kml.barangay !== String(db.barangay).trim()) conflictFields.barangay = { existing: db.barangay, kml: kml.barangay };
  if (newImages.length && !empty(db.image)) conflictFields.image = { existing: String(db.image).split('/').pop(), kmlCount: newImages.length };
  if (kml.phones.length && (contactsByPlace.get(db.id) || []).some((c) => c.kind === 'phone')) conflictFields.phones = { existing: (contactsByPlace.get(db.id) || []).filter((c) => c.kind === 'phone').map((c) => c.value), kml: kml.phones, note: 'different numbers will be ADDED, existing left untouched' };
  if (newImages.length && !empty(db.image_credit) && db.image_credit !== CREDIT) conflictFields.image_credit = { existing: db.image_credit, kml: CREDIT };
  if (Object.keys(conflictFields).length) conflicts.push({ id: db.id, name: db.name, fields: conflictFields });
  changes.push({
    id: db.id, name: db.name, kmlName: kml.name, fields: patchFields, coverMode,
    phonesToAdd: newPhones, skippedPhones: kml.phones.filter((p) => existingPhones.has(digits(p))),
    imagesToUpload: newImages, existingImageCount: existingImages.length,
  });
}

const summary = {
  mode: APPLY ? 'APPLY' : 'DRY RUN',
  kmlPoints: kmlPlaces.length,
  exactMatches: exact.length,
  selectedForThisRun: selected.length,
  reviewCount: review.length,
  descriptionsToAdd: 0,
  barangaysToAdd: changes.filter((c) => c.fields.barangay).length,
  emptyCoverCount: changes.filter((c) => c.coverMode === 'empty-cover').length,
  replacedCoverCount: changes.filter((c) => c.coverMode === 'replace').length,
  contactsToAdd: changes.reduce((n, c) => n + c.phonesToAdd.length, 0),
  imagesToUpload: changes.reduce((n, c) => n + c.imagesToUpload.length, 0),
  estimatedMBAfterCompression: Number((changes.reduce((n, c) => n + c.imagesToUpload.length, 0) * TARGET_BYTES / 1024 / 1024).toFixed(2)),
  conflictCount: conflicts.length,
};
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
fs.writeFileSync(path.join(OUT, `dry-run-${stamp}.json`), JSON.stringify({ summary, changes, conflicts, review }, null, 2));
fs.writeFileSync(path.join(OUT, 'dry-run-latest.json'), JSON.stringify({ summary, changes, conflicts, review }, null, 2));
fs.writeFileSync(path.join(OUT, 'conflicts.json'), JSON.stringify(conflicts, null, 2));
fs.writeFileSync(path.join(OUT, 'review.json'), JSON.stringify(review, null, 2));
const md = [
  `# TREs import — ${summary.mode}`,
  '',
  `- KML points: ${summary.kmlPoints}`,
  `- Exact normalized-name matches: ${summary.exactMatches}`,
  `- Selected this run: ${summary.selectedForThisRun}`,
  `- Descriptions to add: ${summary.descriptionsToAdd}`,
  `- Empty-cover places: ${summary.emptyCoverCount} · replaced covers: ${summary.replacedCoverCount}`,
  `- Barangays to add: ${summary.barangaysToAdd}`,
  `- Phone contacts to add: ${summary.contactsToAdd}`,
  `- Images to upload: ${summary.imagesToUpload}`,
  `- Estimated size after compression: ${summary.estimatedMBAfterCompression} MB`,
  `- Conflicts: ${summary.conflictCount}`,
  `- Review list: ${summary.reviewCount}`,
  '',
  '## Conflicts (first 15)',
  ...conflicts.slice(0, 15).map((c) => `- #${c.id} ${c.name}: ${Object.keys(c.fields).join(', ')}`),
].join('\n');
fs.writeFileSync(path.join(OUT, 'dry-run-latest.md'), md + '\n');

if (!APPLY) {
  console.log(JSON.stringify({ summary, out: OUT, barangaySpellingNote: 'DB uses "Sto. Niño" (3) more than "Santo Nino" (1)' }, null, 2));
  process.exit(0);
}

// ---------- APPLY ----------
let sharp;
try { sharp = createRequire(path.join(SHARP_DIR, 'package.json'))('sharp'); }
catch (e) { throw new Error('sharp unavailable; set SHARP_DIR to a scratch folder with sharp installed: ' + e.message); }

const rollback = {
  createdAt: new Date().toISOString(),
  kml: KML,
  destinationChanges: [], contactIdsAdded: [], uploads: [], failures: [],
};
async function compress(buf, origUrl) {
  let img = sharp(buf).rotate().resize({ width: MAX_WIDTH, withoutEnlargement: true });
  for (const q of [82, 74, 66, 58, 50, 42]) {
    const out = await img.webp({ quality: q }).toBuffer();
    if (out.length <= TARGET_BYTES) return { buf: out, ext: 'webp', type: 'image/webp' };
  }
  const webp = await img.webp({ quality: 40 }).toBuffer();
  if (webp.length <= TARGET_BYTES * 1.5) return { buf: webp, ext: 'webp', type: 'image/webp' };
  img = sharp(buf).rotate().resize({ width: MAX_WIDTH, withoutEnlargement: true });
  for (const q of [80, 70, 60, 50, 40]) {
    const out = await img.jpeg({ quality: q, mozjpeg: true }).toBuffer();
    if (out.length <= TARGET_BYTES) return { buf: out, ext: 'jpg', type: 'image/jpeg' };
  }
  const jpg = await sharp(buf).rotate().resize({ width: MAX_WIDTH, withoutEnlargement: true }).jpeg({ quality: 35, mozjpeg: true }).toBuffer();
  return { buf: jpg, ext: 'jpg', type: 'image/jpeg' };
}
async function uploadOne(googleUrl, placeId) {
  const r = await fetch(googleUrl, { redirect: 'follow' });
  if (!r.ok) throw new Error(`download ${r.status}`);
  const raw = Buffer.from(await r.arrayBuffer());
  const { buf, ext, type } = await compress(raw, googleUrl);
  const p = `dest_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}.${ext}`;
  const up = await fetch(`${URL_BASE}/storage/v1/object/${BUCKET}/${encodeURIComponent(p)}`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': type, 'x-upsert': 'false', 'cache-control': '3600' },
    body: buf,
  });
  if (!up.ok) throw new Error(`upload ${up.status}: ${(await up.text()).slice(0, 200)}`);
  const publicUrl = `${URL_BASE}/storage/v1/object/public/${BUCKET}/${p}`;
  rollback.uploads.push({ placeId, path: p, publicUrl, googleUrl, bytes: buf.length, ext });
  return publicUrl;
}

for (const ch of changes) {
  try {
    const urls = [];
    for (const u of ch.imagesToUpload) urls.push(await uploadOne(u, ch.id));
    if (ch.imagesToUpload.length) {
      if (!importedState[ch.id]) importedState[ch.id] = [];
      for (const u of ch.imagesToUpload) if (!importedState[ch.id].includes(u)) importedState[ch.id].push(u);
    }
    const fields = { ...ch.fields };
    if (fields.image === '__FIRST_NEW_IMAGE__') fields.image = urls[0] || undefined;
    if (Array.isArray(fields.images)) fields.images = fields.images.map((x) => x === '__NEW_IMAGE__' ? urls.shift() : x).filter(Boolean);
    if (!Object.keys(fields).length && !ch.phonesToAdd.length) continue;
    const before = {};
    const beforeRow = destinations.find((d) => d.id === ch.id) || {};
    for (const k of Object.keys(fields)) before[k] = beforeRow[k] ?? null;
    if (Object.keys(fields).length) await patch('destinations', `?id=eq.${ch.id}`, fields);
    if (ch.phonesToAdd.length) {
      const maxSort = Math.max(0, ...(contactsByPlace.get(ch.id) || []).map((c) => Number(c.sort_order) || 0));
      const rows = ch.phonesToAdd.map((v, i) => ({ place_id: ch.id, kind: 'phone', value: v, label: null, sort_order: maxSort + i + 1 }));
      const added = await post('place_contacts', rows);
      for (const a of added) rollback.contactIdsAdded.push(a.id);
    }
    rollback.destinationChanges.push({ id: ch.id, name: ch.name, before, after: fields, phoneValues: ch.phonesToAdd });
  } catch (e) {
    rollback.failures.push({ id: ch.id, name: ch.name, error: String(e.message || e) });
  }
}

fs.writeFileSync(STATE_FILE, JSON.stringify(importedState, null, 2));
const rbFile = path.join(OUT, `rollback-${stamp}.json`);
fs.writeFileSync(rbFile, JSON.stringify(rollback, null, 2));
const revert = `// One-command revert: node scripts/out/revert-${stamp}.mjs
import fs from 'node:fs';
import path from 'node:path';
const cfg = fs.readFileSync('public/site/supabase-config.js','utf8');
const U=(cfg.match(/const SUPABASE_URL\\s*=\\s*"([^"]+)"/)||[])[1];
const K=(cfg.match(/const SUPABASE_ANON_KEY\\s*=\\s*"([^"]+)"/)||[])[1];
const rb=JSON.parse(fs.readFileSync('scripts/out/rollback-${stamp}.json','utf8'));
const H={apikey:K,Authorization:'Bearer '+K,'Content-Type':'application/json'};
const HD={apikey:K,Authorization:'Bearer '+K};
for(const c of rb.destinationChanges){const r=await fetch(U+'/rest/v1/destinations?id=eq.'+c.id,{method:'PATCH',headers:H,body:JSON.stringify(c.before)});if(!r.ok)console.error('restore',c.id,r.status);}
if(rb.contactIdsAdded.length){const r=await fetch(U+'/rest/v1/place_contacts?id=in.('+rb.contactIdsAdded.join(',')+')',{method:'DELETE',headers:HD});if(!r.ok)console.error('contacts',r.status);}
for(const f of rb.uploads){const r=await fetch(U+'/storage/v1/object/'+ '${BUCKET}' +'/'+encodeURIComponent(f.path),{method:'DELETE',headers:HD});if(!r.ok)console.error('file',f.path,r.status);}
console.log('revert complete:',rb.destinationChanges.length,'rows,',rb.contactIdsAdded.length,'contacts,',rb.uploads.length,'files');
`;
const revertFile = path.join(OUT, `revert-${stamp}.mjs`);
fs.writeFileSync(revertFile, revert);
console.log(JSON.stringify({ applied: true, rollback: rbFile, revert: revertFile, updated: rollback.destinationChanges.length, contactsAdded: rollback.contactIdsAdded.length, filesUploaded: rollback.uploads.length, failures: rollback.failures.length, bytesUploaded: rollback.uploads.reduce((n, u) => n + u.bytes, 0) }, null, 2));
