/* Walnut & Brass booking engine (demo).
   Bookings live in this browser's localStorage. A real version keeps them in a
   database that re-checks every booking on the server, so two phones can never
   take the same slot. The checks below mirror that logic. */
window.WB = (() => {
  const SERVICES = [
    {id:'fade',   n:'Skin fade',       p:35, m:45, d:'Taken down to the skin and blended by hand, finished with a hot towel.'},
    {id:'classic',n:'Classic cut',     p:30, m:40, d:'Scissor or clipper cut, washed and styled.'},
    {id:'shave',  n:'Hot towel shave', p:30, m:35, d:'Traditional straight-razor shave with pre-shave oil and two hot towels.'},
    {id:'beard',  n:'Beard sculpt',    p:20, m:25, d:'Shape, line-up and condition, finished with balm.'},
    {id:'combo',  n:'Cut and beard',   p:50, m:60, d:'Any cut plus a full beard sculpt.'},
    {id:'ritual', n:'The full ritual', p:70, m:90, d:'Cut, hot towel shave or beard sculpt, scalp massage and a drink.'}
  ];
  // photo: put an image path here (e.g. 'barbers/mai.webp') and the cards use it.
  const BARBERS = [
    {id:'mai',   name:'Mai',   role:'Skin fades and sharp tapers',            years:'8 years in the chair',  photo:'', off:[]},
    {id:'conor', name:'Conor', role:'Classic cuts and hot towel shaves',      years:'12 years in the chair', photo:'', off:[3]},
    {id:'luca',  name:'Luca',  role:'Beards, textured crops and longer hair', years:'6 years in the chair',  photo:'', off:[6]}
  ];
  // minutes from midnight; null = closed (0 = Sunday)
  const HOURS = {0:null, 1:null, 2:[600,1200], 3:[600,1200], 4:[600,1260], 5:[600,1260], 6:[540,1020]};
  const STEP = 15, LEAD = 30, DAYS_AHEAD = 21;
  const KEY = 'wb-bookings-v1';

  /* ---------- storage (falls back to memory) ---------- */
  let mem = {bookings:[], blocks:[], cancelled:[]};
  const load = () => {
    try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && s.bookings) mem = s; } catch (e) {}
    return mem;
  };
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(mem)); } catch (e) {} emit(); };
  const subs = [];
  const emit = () => subs.forEach(f => f());
  addEventListener('storage', e => { if (e.key === KEY) { load(); emit(); } });
  load();

  /* ---------- dates and times ---------- */
  const pad = n => String(n).padStart(2, '0');
  const dkey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const fromKey = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (k, n) => { const d = fromKey(k); d.setDate(d.getDate() + n); return dkey(d); };
  const today = () => dkey(new Date());
  const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
  const hhmm = m => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
  const dayLabel = (k, opts) => fromKey(k).toLocaleDateString('en-IE', opts || {weekday:'long', day:'numeric', month:'long'});
  const hoursFor = k => HOURS[fromKey(k).getDay()];
  const works = (b, k) => !!hoursFor(k) && !b.off.includes(fromKey(k).getDay());
  const service = id => SERVICES.find(s => s.id === id);
  const barber = id => BARBERS.find(b => b.id === id);

  /* ---------- believable existing bookings, the same every time for a given day ---------- */
  const rng = seed => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const hash = s => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h; };
  const NAMES = ['J. Byrne','S. Murphy','A. Kelly','D. O’Brien','M. Walsh','K. Ryan','P. Doyle','R. Nolan','T. Kavanagh','E. Farrell','C. Quinn','L. Brennan','N. Daly','B. Hogan','F. Moran'];
  const seedCache = {};
  const seeded = (k, bid) => {
    const ck = k + bid;
    if (seedCache[ck]) return seedCache[ck];
    const out = [], b = barber(bid), h = hoursFor(k);
    if (!h || !works(b, k)) return (seedCache[ck] = out);
    const r = rng(hash(ck));
    const lunch = h[0] < 720 && h[1] > 840 ? 780 : null;
    if (lunch) out.push({id:`s-${ck}-lunch`, kind:'block', date:k, barber:bid, start:lunch, dur:30, reason:'Lunch'});
    // further-out days are quieter
    const ahead = Math.max(0, (fromKey(k) - fromKey(today())) / 864e5);
    const busy = Math.max(0.15, 0.5 - ahead * 0.025);
    let t = h[0], i = 0;
    while (t < h[1] - 25) {
      if (lunch && t >= lunch && t < lunch + 30) { t = lunch + 30; continue; }
      const s = SERVICES[Math.floor(r() * SERVICES.length)];
      const fitsLunch = !lunch || t + s.m <= lunch || t >= lunch + 30;
      if (r() < busy && t + s.m <= h[1] && fitsLunch) {
        const ph = String(Math.floor(r() * 9000) + 1000);
        out.push({id:`s-${ck}-${i++}`, kind:'booking', date:k, barber:bid, start:t, dur:s.m, service:s.id,
          name:NAMES[Math.floor(r() * NAMES.length)], phone:`08${Math.floor(r() * 7) + 3} 000 ${ph}`, source:'online'});
        t += s.m;
      } else t += STEP * (1 + Math.floor(r() * 3));
    }
    return (seedCache[ck] = out);
  };

  /* ---------- queries ---------- */
  const dayItems = (k, bid) => {
    const cancelled = new Set(mem.cancelled);
    return [...seeded(k, bid), ...mem.bookings, ...mem.blocks]
      .filter(x => x.date === k && x.barber === bid && !cancelled.has(x.id))
      .sort((a, b) => a.start - b.start);
  };
  const isFree = (k, bid, start, dur) => {
    const b = barber(bid), h = hoursFor(k);
    if (!b || !h || !works(b, k)) return false;
    if (start < h[0] || start + dur > h[1]) return false;
    return !dayItems(k, bid).some(x => start < x.start + x.dur && x.start < start + dur);
  };
  // free start times for one barber or 'any'; each slot lists who is free
  const slots = (k, bid, dur, forShop) => {
    const h = hoursFor(k); if (!h) return [];
    const ids = bid === 'any' ? BARBERS.map(b => b.id) : [bid];
    const minStart = !forShop && k === today() ? Math.ceil((nowMin() + LEAD) / STEP) * STEP : 0;
    const out = [];
    for (let t = h[0]; t + dur <= h[1]; t += STEP) {
      if (t < minStart) continue;
      const free = ids.filter(id => isFree(k, id, t, dur));
      if (free.length) out.push({t, free});
    }
    return out;
  };
  const nextFree = (bid, dur) => {
    let k = today();
    for (let i = 0; i < DAYS_AHEAD; i++, k = addDays(k, 1)) {
      const s = slots(k, bid, dur);
      if (s.length) return {date:k, t:s[0].t, barber:s[0].free[0]};
    }
    return null;
  };

  /* ---------- changes (each one re-checks the slot first) ---------- */
  const ref = () => 'WB-' + Math.random().toString(36).slice(2, 6).toUpperCase();
  const book = o => {
    load(); // pick up anything another tab saved a moment ago
    const s = service(o.service);
    let bid = o.barber;
    if (bid === 'any') bid = BARBERS.map(b => b.id).find(id => isFree(o.date, id, o.start, s.m));
    if (!bid || !isFree(o.date, bid, o.start, s.m)) return {ok:false, reason:'taken'};
    const b = {id:ref(), kind:'booking', date:o.date, barber:bid, start:o.start, dur:s.m, service:s.id,
      name:o.name, phone:o.phone, note:o.note || '', source:o.source || 'online', made:Date.now()};
    mem.bookings.push(b); save();
    return {ok:true, booking:b};
  };
  const block = o => {
    load();
    if (!isFree(o.date, o.barber, o.start, o.dur)) return {ok:false, reason:'taken'};
    const b = {id:'B-' + Date.now().toString(36), kind:'block', date:o.date, barber:o.barber, start:o.start, dur:o.dur, reason:o.reason || 'Blocked'};
    mem.blocks.push(b); save();
    return {ok:true, block:b};
  };
  const cancel = id => {
    load();
    const n = mem.bookings.length + mem.blocks.length;
    mem.bookings = mem.bookings.filter(x => x.id !== id);
    mem.blocks = mem.blocks.filter(x => x.id !== id);
    if (mem.bookings.length + mem.blocks.length === n && !mem.cancelled.includes(id)) mem.cancelled.push(id);
    save();
  };
  const find = id => {
    for (const x of [...mem.bookings, ...mem.blocks]) if (x.id === id) return x;
    return null;
  };
  const reset = () => { mem = {bookings:[], blocks:[], cancelled:[]}; save(); };

  const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const initials = n => n.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();

  /* ---------- barber portrait: the photo if set, otherwise a lit head-and-shoulders placeholder ---------- */
  let faceN = 0;
  const TONES = [['#6a4528', '#1c120b'], ['#4e3a2a', '#150e09'], ['#5d4631', '#19110a']];
  const face = (b, o = {}) => {
    if (b.photo) return `<img src="${esc(b.photo)}" alt="${o.alt ? esc(b.name) : ''}" loading="lazy">`;
    const i = Math.max(0, BARBERS.indexOf(b)) % TONES.length, id = 'wbf' + (faceN++);
    const w = o.w || 160, h = o.h || 100, cx = w / 2, f = n => +n.toFixed(1);
    return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid slice" role="img" aria-label="${esc(b.name)}, photo to come"><defs>` +
      `<radialGradient id="${id}b" cx="50%" cy="28%" r="80%"><stop offset="0" stop-color="${TONES[i][0]}"/><stop offset="1" stop-color="${TONES[i][1]}"/></radialGradient>` +
      `<linearGradient id="${id}s" gradientUnits="userSpaceOnUse" x1="0" y1="${f(h * .18)}" x2="0" y2="${f(h * .75)}"><stop offset="0" stop-color="#3b2918"/><stop offset=".45" stop-color="#150e09"/><stop offset="1" stop-color="#0e0906"/></linearGradient></defs>` +
      `<rect width="${w}" height="${h}" fill="url(#${id}b)"/><g fill="url(#${id}s)">` +
      `<ellipse cx="${cx}" cy="${f(h * .36)}" rx="${f(h * .145)}" ry="${f(h * .175)}"/>` +
      `<path d="M${f(cx - h * .085)} ${f(h * .5)}H${f(cx + h * .085)}L${f(cx + h * .1)} ${f(h * .68)}H${f(cx - h * .1)}Z"/>` +
      `<path d="M${f(cx - h * .46)} ${h + 2}C${f(cx - h * .45)} ${f(h * .8)} ${f(cx - h * .32)} ${f(h * .66)} ${f(cx - h * .12)} ${f(h * .64)}H${f(cx + h * .12)}C${f(cx + h * .32)} ${f(h * .66)} ${f(cx + h * .45)} ${f(h * .8)} ${f(cx + h * .46)} ${h + 2}Z"/></g></svg>`;
  };

  return {SERVICES, BARBERS, HOURS, STEP, DAYS_AHEAD, service, barber, today, addDays, fromKey, dkey, hhmm, dayLabel,
    hoursFor, works, dayItems, isFree, slots, nextFree, book, block, cancel, find, reset, esc, initials, face,
    onChange: f => subs.push(f)};
})();
