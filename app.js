'use strict';
(() => {
  const CFG = window.APP_CONFIG || {};
  const DEFAULT_CAPACITY = 10;
  const MAX_CAPACITY = 30;
  const T_SIZE = 9;          // table diameter, % of room width
  const MAP_RATIO = 16 / 10; // room width / height

  const $ = (s, r = document) => r.querySelector(s);
  const uid = () => (crypto.randomUUID ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16);
      }));
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const r1 = v => Math.round(v * 10) / 10;
  const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

  /* ---------------- Starting layout ---------------- */
  // Layout based on the Skyland Hammurabi reception room photos:
  // couple's table and the "H" stage face each other across the dance floor,
  // a runway leads from the dance floor to the entrance doors, tables on both sides.
  const SEED_TABLES = [
    // Entrance side, above the runway
    [54, 15], [66, 15], [78, 15], [54, 33], [66, 33], [78, 33],
    // Entrance side, below the runway
    [54, 67], [66, 67], [78, 67], [54, 85], [66, 85], [78, 85],
    // Back section, behind the dance floor
    [9, 15], [9, 38], [9, 61], [9, 84], [22, 15], [22, 38], [22, 61], [22, 84],
  ];
  const SEED_AREAS = [
    ["Couple's Table", 'stage', 30, 87, 18, 11],
    ['H Stage / DJ', 'other', 32, 2, 14, 9],
    ['Dance Floor', 'dance', 31, 16, 16, 68],
    ['Runway', 'dance', 47, 45, 44, 10],
    ['Entrance', 'entrance', 92, 40, 7, 20],
    ['Bar', 'bar', 87, 2, 12, 18],
    ['Exit', 'entrance', 12, 93, 8, 6],
  ];

  function seedData() {
    return {
      seating_tables: SEED_TABLES.map(([x, y], i) => ({ id: uid(), name: `Table ${i + 1}`, capacity: DEFAULT_CAPACITY, x, y, sort_order: i + 1 })),
      guests: [],
      venue_items: SEED_AREAS.map(([label, kind, x, y, w, h]) => ({ id: uid(), label, kind, x, y, w, h })),
      app_settings: [],
    };
  }

  /* ---------------- Storage: Supabase or this device ---------------- */
  function localBackend() {
    const KEY = 'skyland-hammurabi-v2';
    let db = null;
    try { db = JSON.parse(localStorage.getItem(KEY)); } catch (e) { /* ignore */ }
    if (!db || !Array.isArray(db.seating_tables)) db = seedData();
    const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { toast('This device is out of storage space.', true); } };
    save();
    const list = rows => (Array.isArray(rows) ? rows : [rows]);
    return {
      mode: 'local',
      async loadAll() { return JSON.parse(JSON.stringify(db)); },
      async insert(t, rows) { db[t].push(...list(rows).map(r => ({ ...r }))); save(); },
      async update(t, id, patch) { const r = db[t].find(x => x.id === id); if (r) Object.assign(r, patch); save(); },
      async remove(t, id) {
        db[t] = db[t].filter(x => x.id !== id);
        if (t === 'seating_tables') db.guests.forEach(g => { if (g.table_id === id) g.table_id = null; });
        save();
      },
      async setSetting(key, value) {
        const s = db.app_settings.find(x => x.key === key);
        if (s) s.value = value; else db.app_settings.push({ key, value });
        save();
      },
      async uploadPhoto(blob) {
        return new Promise((res, rej) => {
          const fr = new FileReader();
          fr.onload = () => res(fr.result);
          fr.onerror = () => rej(fr.error);
          fr.readAsDataURL(blob);
        });
      },
      subscribe() {},
    };
  }

  function cloudBackend() {
    const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_KEY);
    const chk = r => { if (r.error) throw r.error; return r.data; };
    return {
      mode: 'cloud',
      async loadAll() {
        const [t, g, v, s] = await Promise.all([
          sb.from('seating_tables').select('*'),
          sb.from('guests').select('*'),
          sb.from('venue_items').select('*'),
          sb.from('app_settings').select('*'),
        ]);
        return { seating_tables: chk(t), guests: chk(g), venue_items: chk(v), app_settings: chk(s) };
      },
      async insert(t, rows) { chk(await sb.from(t).insert(rows)); },
      async update(t, id, patch) { chk(await sb.from(t).update(patch).eq('id', id)); },
      async remove(t, id) { chk(await sb.from(t).delete().eq('id', id)); },
      async setSetting(key, value) { chk(await sb.from('app_settings').upsert({ key, value })); },
      async uploadPhoto(blob) {
        const ext = (blob.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
        const path = `floorplan-${Date.now()}.${ext}`;
        const up = await sb.storage.from('venue-photos').upload(path, blob, { contentType: blob.type });
        if (up.error) throw up.error;
        return sb.storage.from('venue-photos').getPublicUrl(path).data.publicUrl;
      },
      subscribe(cb) {
        sb.channel('planner')
          .on('postgres_changes', { event: '*', schema: 'public' }, cb)
          .subscribe();
      },
    };
  }

  const backend = (CFG.SUPABASE_URL && CFG.SUPABASE_KEY && window.supabase) ? cloudBackend() : localBackend();

  /* ---------------- State ---------------- */
  let S = { seating_tables: [], guests: [], venue_items: [], app_settings: [] };
  let editMode = false;
  let openTableId = null;
  let openAreaId = null;
  let filter = 'all';
  let query = '';
  let drag = null;
  let renderPending = false;

  const tableById = id => S.seating_tables.find(t => t.id === id);
  const sortedTables = () => [...S.seating_tables].sort((a, b) =>
    ((a.sort_order || 0) - (b.sort_order || 0)) || a.name.localeCompare(b.name, undefined, { numeric: true }));
  const guestsAt = id => S.guests.filter(g => g.table_id === id).sort(byName);
  const isSeated = g => !!(g.table_id && tableById(g.table_id));
  const unseated = () => S.guests.filter(g => !isSeated(g)).sort(byName);
  const setting = k => (S.app_settings.find(s => s.key === k) || {}).value || '';

  async function save(fn) {
    try { await fn(); }
    catch (err) {
      console.error(err);
      const msg = (err && err.message) || String(err);
      toast(msg.includes('Table is full') ? msg : `Couldn't save: ${msg}`, true);
      await reload();
    }
  }

  async function reload() {
    try { S = await backend.loadAll(); render(); }
    catch (err) { console.error(err); toast(`Couldn't load the plan: ${err.message || err}`, true); }
  }
  let reloadTimer = null;
  const scheduleReload = () => { clearTimeout(reloadTimer); reloadTimer = setTimeout(reload, 250); };

  /* ---------------- Actions ---------------- */
  function freeSpot() {
    const rh = (T_SIZE / 2) * MAP_RATIO;
    for (let y = 20; y <= 86; y += 11) {
      for (let x = 7; x <= 93; x += 6.5) {
        const clearOfTables = S.seating_tables.every(t => Math.hypot(t.x - x, (t.y - y) / MAP_RATIO) > T_SIZE * 1.2);
        const clearOfAreas = S.venue_items.every(a =>
          x + T_SIZE / 2 < a.x || x - T_SIZE / 2 > a.x + a.w || y + rh < a.y || y - rh > a.y + a.h);
        if (clearOfTables && clearOfAreas) return [r1(x), r1(y)];
      }
    }
    return [50, 50];
  }

  function addTable() {
    const nums = S.seating_tables.map(t => parseInt((t.name.match(/\d+/) || ['0'])[0], 10));
    const n = Math.max(0, ...nums) + 1;
    const [x, y] = freeSpot();
    const row = {
      id: uid(), name: `Table ${n}`, capacity: DEFAULT_CAPACITY, x, y,
      sort_order: Math.max(0, ...S.seating_tables.map(t => t.sort_order || 0)) + 1,
    };
    S.seating_tables.push(row);
    render();
    const el = $(`.tbl[data-id="${row.id}"]`);
    if (el) { el.classList.add('flash'); el.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' }); }
    toast(`${row.name} added. Use "Arrange room" to move it.`);
    save(() => backend.insert('seating_tables', row));
  }

  function addGuests(names, tableId) {
    names = names.map(n => n.trim().replace(/\s+/g, ' ')).filter(Boolean);
    if (!names.length) return;
    const t = tableId ? tableById(tableId) : null;
    let free = t ? t.capacity - guestsAt(t.id).length : 0;
    const rows = names.map(name => ({ id: uid(), name, table_id: t && free-- > 0 ? t.id : null }));
    const left = t ? rows.filter(r => !r.table_id).length : 0;
    S.guests.push(...rows);
    render();
    if (left) toast(`${t.name} is full. ${plural(left, 'guest')} added to "Not seated".`, true);
    else toast(t ? `${plural(rows.length, 'guest')} seated at ${t.name}` : `${plural(rows.length, 'guest')} added`);
    save(() => backend.insert('guests', rows));
  }

  function moveGuest(guestId, tableId) {
    const g = S.guests.find(x => x.id === guestId);
    if (!g) return;
    tableId = tableId || null;
    if (tableId && tableId !== g.table_id) {
      const t = tableById(tableId);
      if (guestsAt(tableId).length >= t.capacity) {
        toast(`${t.name} is full (${t.capacity}/${t.capacity}). Add a seat or pick another table.`, true);
        render();
        return false;
      }
    }
    g.table_id = tableId;
    render();
    save(() => backend.update('guests', g.id, { table_id: tableId }));
    return true;
  }

  function deleteGuest(guestId) {
    const g = S.guests.find(x => x.id === guestId);
    if (!g || !confirm(`Remove ${g.name} from the guest list?`)) return;
    S.guests = S.guests.filter(x => x.id !== guestId);
    render();
    save(() => backend.remove('guests', guestId));
  }

  function setCapacity(id, cap) {
    const t = tableById(id);
    if (!t) return;
    const seated = guestsAt(id).length;
    cap = clamp(cap, 1, MAX_CAPACITY);
    if (cap < seated) { toast(`${plural(seated, 'guest')} are sitting here. Move someone first.`, true); return; }
    if (cap === t.capacity) return;
    t.capacity = cap;
    render();
    save(() => backend.update('seating_tables', id, { capacity: cap }));
  }

  function renameTable(id, name) {
    const t = tableById(id);
    name = name.trim();
    if (!t || !name || name === t.name) { renderTableDialog(); return; }
    t.name = name;
    render();
    save(() => backend.update('seating_tables', id, { name }));
  }

  function deleteTable(id) {
    const t = tableById(id);
    if (!t) return;
    const n = guestsAt(id).length;
    const msg = n ? `Delete ${t.name}? ${plural(n, 'guest')} will move to "Not seated".` : `Delete ${t.name}?`;
    if (!confirm(msg)) return;
    S.guests.forEach(g => { if (g.table_id === id) g.table_id = null; });
    S.seating_tables = S.seating_tables.filter(x => x.id !== id);
    closeDialog('#table-dialog');
    render();
    toast(`${t.name} deleted`);
    save(() => backend.remove('seating_tables', id));
  }

  function addArea() {
    const label = (prompt('Name this area (for example: Photo booth, Buffet, Stage)') || '').trim();
    if (!label) return;
    const row = { id: uid(), label, kind: 'other', x: 43, y: 40, w: 14, h: 12 };
    S.venue_items.push(row);
    render();
    save(() => backend.insert('venue_items', row));
  }

  async function compressImage(file) {
    try {
      const bmp = await createImageBitmap(file);
      const scale = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas');
      c.width = Math.round(bmp.width * scale);
      c.height = Math.round(bmp.height * scale);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      return await new Promise(res => c.toBlob(b => res(b || file), 'image/jpeg', 0.82));
    } catch (e) {
      return file; // e.g. a format the browser can't draw; upload as-is
    }
  }

  async function setPhoto(file) {
    if (!file) return;
    toast('Uploading floor plan…');
    try {
      const url = await backend.uploadPhoto(await compressImage(file));
      await backend.setSetting('floorplan_url', url);
      await reload();
      toast('Floor plan added. Drag tables to line them up with it.');
    } catch (err) {
      console.error(err);
      toast(`Couldn't upload photo: ${err.message || err}`, true);
    }
  }

  async function removePhoto() {
    if (!confirm('Remove the floor plan photo?')) return;
    await save(() => backend.setSetting('floorplan_url', ''));
    await reload();
  }

  /* ---------------- Rendering ---------------- */
  function render() {
    if (drag) { renderPending = true; return; }
    renderStats();
    renderMap();
    renderGuests();
    renderTableDialog();
    renderGuestDialogTables();
  }

  function renderStats() {
    const total = S.guests.length;
    const seated = S.guests.filter(isSeated).length;
    const seats = S.seating_tables.reduce((s, t) => s + t.capacity, 0);
    const stat = (n, label, warn) => `<div class="stat${warn ? ' warn' : ''}"><b>${n}</b><span>${label}</span></div>`;
    $('#stats').innerHTML =
      stat(S.seating_tables.length, 'Tables') +
      stat(total, 'Guests') +
      stat(seated, 'Seated') +
      stat(total - seated, 'Not seated', total - seated > 0) +
      stat(Math.max(0, seats - seated), 'Empty seats');
  }

  function seatSvg(n, cap) {
    let s = '<svg viewBox="0 0 100 100" aria-hidden="true"><circle class="tt" cx="50" cy="50" r="33"/>';
    const r = cap > 16 ? 3.6 : cap > 12 ? 4.6 : 5.6;
    for (let i = 0; i < cap; i++) {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / cap;
      s += `<circle class="seat${i < n ? ' on' : ''}" cx="${(50 + 44 * Math.cos(a)).toFixed(1)}" cy="${(50 + 44 * Math.sin(a)).toFixed(1)}" r="${r}"/>`;
    }
    return s + '</svg>';
  }

  function tableHtml(t, extraAttrs = '') {
    const n = guestsAt(t.id).length;
    const state = n === 0 ? 'empty' : n >= t.capacity ? 'full' : 'part';
    return `<button type="button" class="tbl ${state}" ${extraAttrs} aria-label="${esc(t.name)}: ${n} of ${t.capacity} seated">` +
      `${seatSvg(n, t.capacity)}<span class="tname">${esc(t.name)}</span><span class="tcount">${n}/${t.capacity}</span></button>`;
  }

  function renderMap() {
    const map = $('#map');
    const bg = setting('floorplan_url');
    map.style.backgroundImage = bg ? `url("${bg.replace(/"/g, '%22')}")` : '';
    map.classList.toggle('has-photo', !!bg);
    map.classList.toggle('editing', editMode);
    $('#btn-photo-remove').hidden = !bg;

    let html = '';
    for (const a of S.venue_items) {
      html += `<div class="area area-${esc(a.kind)}" data-drag data-kind="area" data-id="${esc(a.id)}" ` +
        `style="left:${a.x}%;top:${a.y}%;width:${a.w}%;height:${a.h}%"><span>${esc(a.label)}</span>` +
        `${editMode ? '<i class="resize" aria-hidden="true"></i>' : ''}</div>`;
    }
    for (const t of sortedTables()) {
      html += tableHtml(t, `data-drag data-kind="table" data-id="${esc(t.id)}" style="left:${t.x}%;top:${t.y}%"`);
    }
    map.innerHTML = html;
  }

  function tableOptions(current) {
    let html = `<option value="">Not seated</option>`;
    for (const t of sortedTables()) {
      const n = guestsAt(t.id).length;
      const full = n >= t.capacity && t.id !== current;
      html += `<option value="${esc(t.id)}"${t.id === current ? ' selected' : ''}${full ? ' disabled' : ''}>` +
        `${esc(t.name)} (${n}/${t.capacity})${full ? ' full' : ''}</option>`;
    }
    return html;
  }

  function guestRow(g, removeLabel, removeAttr) {
    const seated = isSeated(g);
    return `<li><span class="gname" title="${esc(g.name)}">${esc(g.name)}</span>` +
      `<select data-guest="${esc(g.id)}" class="${seated ? '' : 'unseated'}" aria-label="Table for ${esc(g.name)}">${tableOptions(seated ? g.table_id : null)}</select>` +
      `<button type="button" class="icon-btn" ${removeAttr}="${esc(g.id)}" aria-label="${removeLabel} ${esc(g.name)}" title="${removeLabel}">&times;</button></li>`;
  }

  function renderGuests() {
    const q = query.trim().toLowerCase();
    let list = [...S.guests].sort(byName);
    if (filter === 'seated') list = list.filter(isSeated);
    if (filter === 'unseated') list = list.filter(g => !isSeated(g));
    if (q) list = list.filter(g => g.name.toLowerCase().includes(q) || ((tableById(g.table_id) || {}).name || '').toLowerCase().includes(q));

    const counts = { all: S.guests.length, unseated: unseated().length, seated: S.guests.filter(isSeated).length };
    document.querySelectorAll('.tabs button').forEach(b => {
      const f = b.dataset.filter;
      b.classList.toggle('on', f === filter);
      b.setAttribute('aria-selected', f === filter);
      b.textContent = `${{ all: 'All', unseated: 'Not seated', seated: 'Seated' }[f]} (${counts[f]})`;
    });

    $('#guest-list').innerHTML = list.length
      ? list.map(g => guestRow(g, 'Remove guest', 'data-del-guest')).join('')
      : `<li class="empty">${S.guests.length ? 'No guests match.' : 'No guests yet. Tap "+ Add guests" to start.'}</li>`;
  }

  function renderTableDialog() {
    if (!openTableId) return;
    const t = tableById(openTableId);
    if (!t) { closeDialog('#table-dialog'); return; }
    const list = guestsAt(t.id);
    const n = list.length;
    const nameInput = $('#tm-name');
    if (document.activeElement !== nameInput) nameInput.value = t.name;
    $('#tm-ring').innerHTML = tableHtml(t, 'tabindex="-1"');
    $('#tm-count').textContent = `${n} of ${t.capacity} seated`;
    $('#tm-free').textContent = n >= t.capacity ? 'This table is full' : `${plural(t.capacity - n, 'empty seat')}`;
    $('#tm-cap').textContent = t.capacity;
    $('#tm-guests').innerHTML = n
      ? list.map(g => guestRow(g, 'Take off this table:', 'data-unseat')).join('')
      : '<li class="empty">Nobody here yet. Add a name below.</li>';
    const full = n >= t.capacity;
    $('#tm-add').disabled = full;
    $('#tm-add-btn').disabled = full;
    $('#tm-add').placeholder = full ? 'Table is full' : "Type a guest's name";
    renderPicks();
  }

  function renderPicks() {
    const box = $('#tm-picks');
    const t = openTableId && tableById(openTableId);
    if (!t || guestsAt(t.id).length >= t.capacity) { box.innerHTML = ''; return; }
    const q = $('#tm-add').value.trim().toLowerCase();
    const all = unseated();
    const list = all.filter(g => !q || g.name.toLowerCase().includes(q)).slice(0, 24);
    if (!list.length) { box.innerHTML = ''; return; }
    box.innerHTML = `<span class="label">Not seated yet, tap to seat here${all.length > list.length ? ` (showing ${list.length} of ${all.length})` : ''}:</span>` +
      list.map(g => `<button type="button" class="chip" data-pick="${esc(g.id)}">${esc(g.name)}</button>`).join('');
  }

  function renderGuestDialogTables() {
    const sel = $('#gd-table');
    const keep = sel.value;
    sel.innerHTML = tableOptions(null);
    if ([...sel.options].some(o => o.value === keep && !o.disabled)) sel.value = keep;
  }

  /* ---------------- Dialogs ---------------- */
  function openDialog(sel) { const d = $(sel); if (!d.open) d.showModal(); }
  function closeDialog(sel) { const d = $(sel); if (d.open) d.close(); }

  function openTable(id) {
    openTableId = id;
    $('#tm-add').value = '';
    renderTableDialog();
    openDialog('#table-dialog');
  }

  function addFromTableDialog() {
    const t = tableById(openTableId);
    const input = $('#tm-add');
    const name = input.value.trim().replace(/\s+/g, ' ');
    if (!t || !name) return;
    const match = S.guests.find(g => g.name.toLowerCase() === name.toLowerCase());
    if (match) {
      if (match.table_id === t.id) { toast(`${match.name} is already at this table`); input.value = ''; renderPicks(); return; }
      const from = isSeated(match) ? tableById(match.table_id) : null;
      if (from && !confirm(`${match.name} is at ${from.name}. Move them here?`)) return;
      if (moveGuest(match.id, t.id) !== false) input.value = '';
    } else {
      addGuests([name], t.id);
      input.value = '';
    }
    renderPicks();
    input.focus();
  }

  function openArea(id) {
    const a = S.venue_items.find(x => x.id === id);
    if (!a) return;
    openAreaId = id;
    $('#ad-label').value = a.label;
    openDialog('#area-dialog');
  }

  /* ---------------- Dragging (Arrange room) ---------------- */
  const map = $('#map');

  map.addEventListener('pointerdown', e => {
    if (!editMode || e.button > 0) return;
    const el = e.target.closest('[data-drag]');
    if (!el) return;
    const kind = el.dataset.kind;
    const id = el.dataset.id;
    const row = kind === 'table' ? tableById(id) : S.venue_items.find(a => a.id === id);
    if (!row) return;
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    drag = { el, kind, id, row, resize: !!e.target.closest('.resize'), sx: e.clientX, sy: e.clientY,
      orig: { ...row }, rect: map.getBoundingClientRect(), moved: false };
  });

  map.addEventListener('pointermove', e => {
    if (!drag) return;
    const dxPx = e.clientX - drag.sx, dyPx = e.clientY - drag.sy;
    if (!drag.moved && Math.hypot(dxPx, dyPx) < 5) return;
    if (!drag.moved) { drag.moved = true; drag.el.classList.add('dragging'); }
    const dx = (dxPx / drag.rect.width) * 100;
    const dy = (dyPx / drag.rect.height) * 100;
    const { row, orig, el } = drag;
    if (drag.kind === 'table') {
      const rw = T_SIZE / 2, rh = rw * MAP_RATIO;
      row.x = r1(clamp(orig.x + dx, rw, 100 - rw));
      row.y = r1(clamp(orig.y + dy, rh, 100 - rh));
      el.style.left = row.x + '%'; el.style.top = row.y + '%';
    } else if (drag.resize) {
      row.w = r1(clamp(orig.w + dx, 4, 100 - orig.x));
      row.h = r1(clamp(orig.h + dy, 4, 100 - orig.y));
      el.style.width = row.w + '%'; el.style.height = row.h + '%';
    } else {
      row.x = r1(clamp(orig.x + dx, 0, 100 - orig.w));
      row.y = r1(clamp(orig.y + dy, 0, 100 - orig.h));
      el.style.left = row.x + '%'; el.style.top = row.y + '%';
    }
  });

  function endDrag(cancelled) {
    if (!drag) return;
    const d = drag;
    drag = null;
    d.el.classList.remove('dragging');
    if (d.moved && !cancelled) {
      const t = d.kind === 'table' ? 'seating_tables' : 'venue_items';
      const patch = d.kind === 'table' ? { x: d.row.x, y: d.row.y } : { x: d.row.x, y: d.row.y, w: d.row.w, h: d.row.h };
      save(() => backend.update(t, d.id, patch));
    } else if (cancelled) {
      Object.assign(d.row, d.orig);
    } else if (d.kind === 'table') {
      openTable(d.id);
    } else {
      openArea(d.id);
    }
    if (renderPending || cancelled) { renderPending = false; render(); }
  }
  map.addEventListener('pointerup', () => endDrag(false));
  map.addEventListener('pointercancel', () => endDrag(true));

  map.addEventListener('click', e => {
    if (editMode) return; // handled by pointerup
    const el = e.target.closest('.tbl[data-id]');
    if (el) openTable(el.dataset.id);
  });

  function setEditMode(on) {
    editMode = on;
    $('#edit-bar').hidden = !on;
    $('#btn-arrange').classList.toggle('on', on);
    $('#btn-arrange').textContent = on ? 'Arranging…' : 'Arrange room';
    render();
    if (on) $('#edit-bar').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  /* ---------------- Print ---------------- */
  function printList() {
    const sheet = $('#print-sheet');
    const secs = sortedTables().map(t => {
      const list = guestsAt(t.id);
      return `<section><h2>${esc(t.name)} (${list.length}/${t.capacity})</h2>` +
        (list.length ? `<ol>${list.map(g => `<li>${esc(g.name)}</li>`).join('')}</ol>` : '<p>Empty</p>') + '</section>';
    });
    const un = unseated();
    if (un.length) secs.push(`<section><h2>Not seated (${un.length})</h2><ol>${un.map(g => `<li>${esc(g.name)}</li>`).join('')}</ol></section>`);
    sheet.innerHTML = `<h1>Skyland Hammurabi seating</h1><div class="cols">${secs.join('')}</div>`;
    window.print();
  }

  /* ---------------- Toast ---------------- */
  let toastTimer = null;
  function toast(msg, bad) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.toggle('bad', !!bad);
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), bad ? 4500 : 2600);
  }

  /* ---------------- Wiring ---------------- */
  $('#btn-add-table').addEventListener('click', addTable);
  $('#btn-add-guests').addEventListener('click', () => {
    $('#gd-names').value = '';
    renderGuestDialogTables();
    $('#gd-table').value = '';
    openDialog('#guests-dialog');
    setTimeout(() => $('#gd-names').focus(), 50);
  });
  $('#gd-save').addEventListener('click', () => {
    const names = $('#gd-names').value.split(/\r?\n|,/);
    if (!names.some(n => n.trim())) { toast('Type at least one name', true); return; }
    addGuests(names, $('#gd-table').value || null);
    closeDialog('#guests-dialog');
  });
  $('#btn-arrange').addEventListener('click', () => setEditMode(!editMode));
  $('#btn-done').addEventListener('click', () => { setEditMode(false); toast('Room layout saved'); });
  $('#btn-add-area').addEventListener('click', addArea);
  $('#btn-photo').addEventListener('click', () => $('#photo-input').click());
  $('#photo-input').addEventListener('change', e => { setPhoto(e.target.files[0]); e.target.value = ''; });
  $('#btn-photo-remove').addEventListener('click', removePhoto);
  $('#btn-print').addEventListener('click', printList);

  $('#guest-search').addEventListener('input', e => { query = e.target.value; renderGuests(); });
  document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => { filter = b.dataset.filter; renderGuests(); }));

  // Table / guest controls anywhere on the page
  document.addEventListener('change', e => {
    const sel = e.target.closest('select[data-guest]');
    if (sel) moveGuest(sel.dataset.guest, sel.value);
  });
  document.addEventListener('click', e => {
    const del = e.target.closest('[data-del-guest]');
    if (del) return deleteGuest(del.dataset.delGuest);
    const un = e.target.closest('[data-unseat]');
    if (un) return moveGuest(un.dataset.unseat, null);
    const pick = e.target.closest('[data-pick]');
    if (pick) return moveGuest(pick.dataset.pick, openTableId);
    if (e.target.closest('[data-close]')) {
      const d = e.target.closest('dialog');
      if (d) d.close();
    }
  });

  // Table dialog
  $('#tm-name').addEventListener('change', e => renameTable(openTableId, e.target.value));
  $('#tm-name').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } });
  $('#tm-add').addEventListener('input', renderPicks);
  $('#tm-add').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addFromTableDialog(); } });
  $('#tm-add-btn').addEventListener('click', addFromTableDialog);
  $('#cap-minus').addEventListener('click', () => { const t = tableById(openTableId); if (t) setCapacity(t.id, t.capacity - 1); });
  $('#cap-plus').addEventListener('click', () => { const t = tableById(openTableId); if (t) setCapacity(t.id, t.capacity + 1); });
  $('#tm-delete').addEventListener('click', () => deleteTable(openTableId));
  $('#table-dialog').addEventListener('close', () => {
    const input = $('#tm-name');
    if (openTableId && input.value.trim() && input.value.trim() !== (tableById(openTableId) || {}).name) renameTable(openTableId, input.value);
    openTableId = null;
  });

  // Area dialog
  $('#ad-save').addEventListener('click', () => {
    const a = S.venue_items.find(x => x.id === openAreaId);
    const label = $('#ad-label').value.trim();
    if (a && label && label !== a.label) {
      a.label = label;
      render();
      save(() => backend.update('venue_items', a.id, { label }));
    }
    closeDialog('#area-dialog');
  });
  $('#ad-label').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('#ad-save').click(); } });
  $('#ad-delete').addEventListener('click', () => {
    const a = S.venue_items.find(x => x.id === openAreaId);
    if (!a || !confirm(`Delete "${a.label}" from the room?`)) return;
    S.venue_items = S.venue_items.filter(x => x.id !== a.id);
    closeDialog('#area-dialog');
    render();
    save(() => backend.remove('venue_items', a.id));
  });

  // Close dialogs by tapping the dark background
  document.querySelectorAll('dialog').forEach(d => d.addEventListener('click', e => { if (e.target === d) d.close(); }));

  /* ---------------- Start ---------------- */
  const modeEl = $('#mode');
  if (backend.mode === 'cloud') {
    modeEl.textContent = 'Live · saved to cloud';
    modeEl.classList.add('live');
    backend.subscribe(scheduleReload);
  } else {
    modeEl.textContent = 'Demo · saved on this device';
    modeEl.title = 'Add Supabase details in config.js to share the plan between phones.';
  }
  reload();
})();
