// Phase 3/4 finisher: apply 4 confident matches, create remaining KML places as drafts.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'scripts', 'out');
fs.mkdirSync(OUT, { recursive: true });
const KML = process.env.TRE_KML || 'C:/Users/growp/Downloads/TREs San Vicente, Palawan.kml';
const SHARP_DIR = process.env.SHARP_DIR || 'C:/Users/growp/AppData/Local/Temp/opencode/tres-img';
const cfg = fs.readFileSync(path.join(ROOT, 'public/site/supabase-config.js'), 'utf8');
const U = (cfg.match(/const SUPABASE_URL\s*=\s*"([^"]+)"/) || [])[1];
const K = (cfg.match(/const SUPABASE_ANON_KEY\s*=\s*"([^"]+)"/) || [])[1];
if (!U || !K) throw new Error('Supabase config not found');
const BUCKET = 'destination-images';
const CREDIT = 'Photo: Municipal Tourism Office, San Vicente';
const MAX_IMAGES = 8;
const MAX_WIDTH = 1600;
const TARGET = 250 * 1024;
const H = { apikey: K, Authorization: 'Bearer ' + K };
const HJ = { ...H, 'Content-Type': 'application/json' };
const api = async (t, q = '') => { const r = await fetch(`${U}/rest/v1/${t}${q}`, { headers: H }); if (!r.ok) throw new Error(`${t} ${r.status}: ${(await r.text()).slice(0,200)}`); return r.json(); };
const patch = async (t, q, body) => { const r = await fetch(`${U}/rest/v1/${t}${q}`, { method: 'PATCH', headers: { ...HJ, Prefer: 'return=representation' }, body: JSON.stringify(body) }); if (!r.ok) throw new Error(`PATCH ${t} ${r.status}: ${(await r.text()).slice(0,200)}`); return r.json(); };
const post = async (t, rows) => { const r = await fetch(`${U}/rest/v1/${t}`, { method: 'POST', headers: { ...HJ, Prefer: 'return=representation' }, body: JSON.stringify(rows) }); if (!r.ok) throw new Error(`POST ${t} ${r.status}: ${(await r.text()).slice(0,200)}`); return r.json(); };

const STATE_FILE = path.join(OUT, 'imported-images.json');
const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
const sharp = createRequire(path.join(SHARP_DIR, 'package.json'))('sharp');

const decode = s => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&quot;/gi,'"').replace(/&#39;/gi,"'").replace(/&#x27;/gi,"'");
const grab = (b,t) => { const m=b.match(new RegExp('<'+t+'>([\\s\\S]*?)</'+t+'>','i')); return m?decode(m[1]).trim():''; };
const PHONE = /(?:\+?63|0)?9\d{2}[\s\-.]?\d{3}[\s\-.]?\d{4}/g;
const digits = s => String(s||'').replace(/\D/g,'');
const norm = s => String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
const toks = s => new Set(norm(s).split(' ').filter(w=>w.length>2));
const jac = (a,b) => { const A=toks(a),B=toks(b); if(!A.size||!B.size) return 0; let h=0; for(const x of A) if(B.has(x)) h++; return h/(A.size+B.size-h); };
const hav = (a,b,c,d) => { const R=6371000,q=Math.PI/180,dLat=(c-a)*q,dLng=(d-b)*q,x=Math.sin(dLat/2)**2+Math.cos(a*q)*Math.cos(c*q)*Math.sin(dLng/2)**2; return Math.round(2*R*Math.asin(Math.sqrt(x))); };
function clean(raw){ let t=String(raw||'').replace(/<br\s*\/?>/gi,'\n').replace(/<\/(p|div|li|tr|h[1-6])>/gi,'\n').replace(/<[^>]+>/g,''); t=decode(t); t=t.replace(/\bdescription:\s*/gi,''); t=t.replace(/\bid:\s*\d*\s*/gi,''); t=t.replace(/Contact\s*(?:No|Number|#)?\s*:\s*/gi,''); t=t.replace(PHONE,''); t=t.replace(/https?:\/\/\S+/gi,''); return t.split(/[\r\n]+/).map(x=>x.trim()).filter(Boolean).join(' ').replace(/\s+/g,' ').trim(); }
const imgUrls = raw => [...new Set([...String(raw||'').matchAll(/<img[^>]+src\s*=\s*["']([^"']+)["']/gi)].map(m=>m[1]))];

const CAT_RULES = [
  ['nightlife', /cocktail|night ?club|videoke|karaoke|reggae/],
  ['stays', /accom|resort|hotel|guest ?house|\binn\b|cottage|lodge|pension|homestay|hostel|bed and breakfast|b&b|\brooms?\b|\bvilla\b|travellers? (inn|pad)|transient/],
  ['food', /resto|restaurant|eatery|grill|bistro|cafe|coffee|carinderia|kitchen|\bmenu\b|\bbar\b|\bfood\b|snack|bakery|dining/],
  ['waterfalls', /waterfall|\bfalls\b/],
  ['islands', /\bisland\b/],
  ['beaches', /\bbeach\b/],
  ['nature', /mangrove|forest|lagoon|spring|cave|reef/],
  ['sport', /surf|kite|paddle|dive|snorkel|freediv|\bsport\b/],
  ['adventure', /trek|hike|tour|adventure|camping|island hopping/],
  ['services', /spa|massage|laundry|salon|clinic|rental|travel and tours|\bshop\b|\bstore\b|money|atm|terminal|\bport\b/],
];
const BARANGAY_HINTS = [
  ['Port Barton',['port barton','portbarton']], ['Poblacion',['poblacion','pob.']],
  ['New Agutaya',['new agutaya','agutaya']], ['Sto. Niño',['sto nino','santo nino','sto. niño','santo niño']],
  ['San Isidro',['san isidro']], ['Alimanguan',['alimanguan']], ['Binga',['binga']],
  ['Kemdeng',['kemdeng']], ['Caruray',['caruray']], ['New Canipo',['new canipo','canipo']],
];
function guessCategory(row, keys){ const hay=(row.folder+' '+row.name+' '+row.description).toLowerCase().replace(/[_-]+/g,' '); for(const [k,re] of CAT_RULES) if(keys.includes(k)&&re.test(hay)) return k; for(const k of keys){ if(hay.includes(k.toLowerCase())) return k; } return keys.includes('stays')?'stays':keys[0]; }
function guessBarangay(row, near){ const hay=(row.folder+' '+row.name+' '+row.description).toLowerCase().replace(/[_-]+/g,' '); for(const [b,hints] of BARANGAY_HINTS) if(hints.some(h=>hay.includes(h))) return b; return near?near.barangay||'':''; }

// --- KML parse ---
const xml=fs.readFileSync(KML,'utf8');
const toksXml=[...xml.matchAll(/<(\/?)Folder>|<(\/?)Placemark>/gi)].map(m=>({k:(m[1]?'cf':(m[2]?'cp':(m[0].toLowerCase()==='<folder>'?'of':'op'))),i:m.index,f:m[0]}));
const stack=[],blocks=[]; let cur=null;
for(const t of toksXml){ if(t.k==='of') stack.push(grab(xml.slice(t.i,t.i+500),'name')||'?'); else if(t.k==='cf') stack.pop(); else if(t.k==='op') cur={start:t.i+t.f.length,folder:stack.join(' / ')}; else if(t.k==='cp'&&cur){ blocks.push({...cur,block:xml.slice(cur.start,t.i)}); cur=null; } }
const kmlAll=[];
for(const p of blocks){ const b=p.block; if(!/<Point>/i.test(b)) continue; const c=(b.match(/<coordinates>([^<]+)<\/coordinates>/i)||[])[1]||''; const [lng,lat]=c.split(',').map(Number); if(!Number.isFinite(lat)||!Number.isFinite(lng)) continue; const raw=grab(b,'description'); const ext=[...b.matchAll(/<Data\s+name="([^"]+)">\s*<value>([\s\S]*?)<\/value>/gi)].map(m=>decode(m[2])).join(' '); const name=grab(b,'name'); const allText=raw+' '+ext; kmlAll.push({ name:(name.startsWith('April')?"April's Tourist Inn":name), lat, lng, folder:p.folder, rawDescription:raw, description:clean(raw), phones:[...new Set((allText.match(PHONE)||[]).map(x=>x.trim()))], images:imgUrls(allText) }); }

// --- live data ---
const destinations=await api('destinations','?select=*&limit=1000');
const contacts=await api('place_contacts','?select=id,place_id,kind,value&limit=2000');
const categories=await api('destination_categories','?select=key,label&limit=100');
const catKeys=categories.map(c=>c.key);
const exactNames=new Set(destinations.map(d=>norm(d.name)));
const existingPhones=new Set(contacts.filter(c=>c.kind==='phone').map(c=>digits(c.value)));

const CONFIDENT = [
  {id:13, kml:'Hotel Elizabeth Resorts'},
  {id:20, kml:'Parrots Boutique Resort with Bar & Restaurant'},
  {id:27, kml:'Hotel Oasis Port Barton Inc.'},
  {id:70, kml:'Malaika Cocktail and Restaurant'},
];
const appliedKml = new Set(CONFIDENT.map(x=>x.kml));
const toCreate = kmlAll.filter(p=>!exactNames.has(norm(p.name)) && !appliedKml.has(p.name));

const stamp=new Date().toISOString().replace(/[:.]/g,'-');
const rb={createdAt:new Date().toISOString(),updated:[],created:[],contactIdsAdded:[],uploads:[],failures:[],skipped:[]};
async function compress(buf){ let img=sharp(buf).rotate().resize({width:MAX_WIDTH,withoutEnlargement:true}); for(const q of [82,74,66,58,50,42]){ const o=await img.webp({quality:q}).toBuffer(); if(o.length<=TARGET) return {buf:o,ext:'webp',type:'image/webp'}; } const w=await img.webp({quality:40}).toBuffer(); if(w.length<=TARGET*1.5) return {buf:w,ext:'webp',type:'image/webp'}; img=sharp(buf).rotate().resize({width:MAX_WIDTH,withoutEnlargement:true}); for(const q of [80,70,60,50,40]){ const o=await img.jpeg({quality:q,mozjpeg:true}).toBuffer(); if(o.length<=TARGET) return {buf:o,ext:'jpg',type:'image/jpeg'}; } return {buf:await sharp(buf).rotate().resize({width:MAX_WIDTH,withoutEnlargement:true}).jpeg({quality:35,mozjpeg:true}).toBuffer(),ext:'jpg',type:'image/jpeg'}; }
async function upload(url, placeRef){ const r=await fetch(url,{redirect:'follow'}); if(!r.ok) throw new Error('download '+r.status); const raw=Buffer.from(await r.arrayBuffer()); const {buf,ext,type}=await compress(raw); const p=`dest_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,9)}.${ext}`; const up=await fetch(`${U}/storage/v1/object/${BUCKET}/${encodeURIComponent(p)}`,{method:'POST',headers:{...H,'Content-Type':type,'x-upsert':'false','cache-control':'3600'},body:buf}); if(!up.ok) throw new Error('upload '+up.status+': '+(await up.text()).slice(0,150)); const publicUrl=`${U}/storage/v1/object/public/${BUCKET}/${p}`; rb.uploads.push({placeRef,path:p,publicUrl,googleUrl:url,bytes:buf.length}); if(!state[placeRef]) state[placeRef]=[]; if(!state[placeRef].includes(url)) state[placeRef].push(url); return publicUrl; }
async function uploadMany(urls, placeRef){ const out=[]; for(const u of urls.slice(0,MAX_IMAGES)){ try{ out.push(await upload(u,placeRef)); }catch(e){ rb.failures.push({placeRef,url:u.slice(0,120),error:String(e.message||e)}); } } return out; }

// 1) 4 confident updates
for(const c of CONFIDENT){
  const kml=kmlAll.find(p=>p.name===c.kml); const db=destinations.find(d=>d.id===c.id);
  if(!kml||!db){ rb.failures.push({id:c.id,error:'missing kml or db row'}); continue; }
  try{
    const urls=await uploadMany(kml.images, 'existing:'+c.id);
    const patchBody={};
    if(urls.length){ patchBody.image=urls[0]; patchBody.images=urls; if(db.image_credit==null||String(db.image_credit).trim()==='') patchBody.image_credit=CREDIT; }
    const have=new Set(contacts.filter(x=>x.place_id===c.id&&x.kind==='phone').map(x=>digits(x.value)));
    const newPhones=kml.phones.filter(p=>!have.has(digits(p)));
    const before={}; for(const f of Object.keys(patchBody)) before[f]=db[f]??null;
    if(Object.keys(patchBody).length) await patch('destinations',`?id=eq.${c.id}`,patchBody);
    if(newPhones.length){ const rows=newPhones.map(v=>({place_id:c.id,kind:'phone',value:v,label:null,sort_order:0})); const added=await post('place_contacts',rows); added.forEach(a=>rb.contactIdsAdded.push(a.id)); }
    rb.updated.push({id:c.id,name:db.name,kmlName:c.kml,before,after:patchBody,phones:newPhones});
  }catch(e){ rb.failures.push({id:c.id,name:db.name,error:String(e.message||e)}); }
}

// 2) create remaining KML places, skipping duplicates
const createdNames=[];
for(const p of toCreate){
  const near=destinations.filter(d=>Number.isFinite(d.lat)&&Number.isFinite(d.lng)).map(d=>({d,m:hav(p.lat,p.lng,Number(d.lat),Number(d.lng))})).filter(x=>x.m<75).sort((a,b)=>a.m-b.m)[0]?.d||null;
  const dupName=destinations.find(d=>{ const a=norm(d.name),b=norm(p.name); return a===b || (a.length>5&&b.includes(a)) || (b.length>5&&a.includes(b)) || jac(d.name,p.name)>=0.7; });
  const dupPhone=p.phones.find(ph=>existingPhones.has(digits(ph)));
  const dupCreated=createdNames.find(n=>jac(n,p.name)>=0.7 || (norm(n).length>5&&norm(p.name).includes(norm(n))));
  if(dupName||dupPhone||dupCreated){ rb.skipped.push({name:p.name,reason:dupName?`fuzzy name → ${dupName.id}:${dupName.name}`:dupPhone?`same phone ${dupPhone} → existing contact`:`duplicate of created row ${dupCreated}`}); continue; }
  try{
    const urls=await uploadMany(p.images,'new:'+p.name);
    const category=guessCategory({...p,description:p.description},catKeys);
    const barangay=guessBarangay(p,near);
    const row={name:p.name,lat:p.lat,lng:p.lng,barangay,category,description:p.description,image:urls[0]||'',images:urls,image_credit:urls.length?CREDIT:'', status:'draft'};
    const inserted=await post('destinations',[row]);
    const id=inserted[0]?.id;
    if(!id) throw new Error('insert returned no id');
    const have=new Set(); const newPhones=p.phones.filter(ph=>!have.has(digits(ph)));
    if(newPhones.length){ const rows=newPhones.map(v=>({place_id:id,kind:'phone',value:v,label:null,sort_order:0})); const added=await post('place_contacts',rows); added.forEach(a=>rb.contactIdsAdded.push(a.id)); }
    newPhones.forEach(ph=>existingPhones.add(digits(ph)));
    createdNames.push(p.name);
    rb.created.push({id,name:p.name,row,phones:newPhones});
  }catch(e){ rb.failures.push({name:p.name,error:String(e.message||e)}); }
}

fs.writeFileSync(STATE_FILE,JSON.stringify(state,null,2));
const rbFile=path.join(OUT,`rollback-${stamp}.json`);
fs.writeFileSync(rbFile,JSON.stringify(rb,null,2));
const revert=`// One-command revert: node scripts/out/revert-${stamp}.mjs
import fs from 'node:fs';
const cfg=fs.readFileSync('public/site/supabase-config.js','utf8');
const U=(cfg.match(/const SUPABASE_URL\\s*=\\s*"([^"]+)"/)||[])[1];
const K=(cfg.match(/const SUPABASE_ANON_KEY\\s*=\\s*"([^"]+)"/)||[])[1];
const H={apikey:K,Authorization:'Bearer '+K,'Content-Type':'application/json'};
const HD={apikey:K,Authorization:'Bearer '+K};
const rb=JSON.parse(fs.readFileSync('scripts/out/rollback-${stamp}.json','utf8'));
for(const c of rb.updated){const r=await fetch(U+'/rest/v1/destinations?id=eq.'+c.id,{method:'PATCH',headers:H,body:JSON.stringify(c.before)});if(!r.ok)console.error('restore',c.id,r.status);}
if(rb.contactIdsAdded.length){const r=await fetch(U+'/rest/v1/place_contacts?id=in.('+rb.contactIdsAdded.join(',')+')',{method:'DELETE',headers:HD});if(!r.ok)console.error('contacts',r.status);}
const ids=rb.created.map(c=>c.id);if(ids.length){const r=await fetch(U+'/rest/v1/destinations?id=in.('+ids.join(',')+')',{method:'DELETE',headers:HD});if(!r.ok)console.error('created rows',r.status);}
for(const f of rb.uploads){const r=await fetch(U+'/storage/v1/object/${BUCKET}/'+encodeURIComponent(f.path),{method:'DELETE',headers:HD});if(!r.ok)console.error('file',f.path,r.status);}
console.log('revert complete:',rb.updated.length,'updated,',rb.created.length,'created,',rb.contactIdsAdded.length,'contacts,',rb.uploads.length,'files');
`;
const revFile=path.join(OUT,`revert-${stamp}.mjs`); fs.writeFileSync(revFile,revert);
const bytes=rb.uploads.reduce((n,u)=>n+u.bytes,0);
console.log(JSON.stringify({updated:rb.updated.length,updatedNames:rb.updated.map(x=>x.name),created:rb.created.length,createdNames:rb.created.map(x=>`${x.id}:${x.name}`),skipped:rb.skipped,images:rb.uploads.length,MB:Number((bytes/1024/1024).toFixed(2)),failures:rb.failures,rollback:rbFile,revert:revFile},null,2));
