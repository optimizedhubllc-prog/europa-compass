// Europa Compass — Social Import
// Adds an "Import from TikTok" card to Voyage Sync. Paste a link and/or add
// screenshots → Claude extracts the spots → Google Places pins them → review
// and add the ones you want to the shared trip.
// Relies on globals from index.html: syncSession, api, refreshSync, whenGmapsReady, showTab.
(function () {
  const CAT_ICONS = {
    food: '🍽', cafe: '☕', bar: '🍷', attraction: '🏛', park: '🌳',
    shop: '🛍', hotel: '🛏', viewpoint: '🌅', nightlife: '🎶', other: '📍',
  };
  const CAT_LABELS = {
    food: 'Food', cafe: 'Cafe', bar: 'Bar', attraction: 'Attraction', park: 'Park',
    shop: 'Shop', hotel: 'Hotel', viewpoint: 'Viewpoint', nightlife: 'Nightlife', other: 'Other',
  };
  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let pending = [];
  let sourceLabel = 'TikTok';
  let files = [];

  const session = () => (typeof syncSession !== 'undefined' ? syncSession : null);

  // ── Styles (matches the app's parchment / terracotta palette) ──
  const style = document.createElement('style');
  style.textContent = `
    #imp-card{background:white;border-radius:12px;border:.5px solid #e0dbd4;border-left:3px solid var(--terracotta);padding:20px;margin-bottom:14px}
    .imp-title{font-family:'Cormorant Garamond',serif;font-size:1.2rem;font-weight:600;color:var(--deep);margin-bottom:3px}
    .imp-sub{font-size:.8rem;color:#888;line-height:1.5;margin-bottom:12px}
    .imp-row{display:flex;gap:7px;margin-bottom:8px}
    .imp-row input{flex:1;min-width:0}
    .imp-ghost{background:#f5f0e8;border:none;border-radius:8px;padding:0 14px;font-family:inherit;font-size:.78rem;font-weight:600;color:var(--slate);cursor:pointer}
    .imp-file{display:flex;align-items:center;gap:8px;border:1.5px dashed #d8d2c8;border-radius:8px;padding:10px 12px;font-size:.8rem;color:var(--slate);cursor:pointer;margin-bottom:10px}
    .imp-file.has{border-style:solid;border-color:var(--gold);background:#fef9ed}
    .imp-thumbs{display:flex;gap:5px;margin-left:auto}
    .imp-thumbs img{width:26px;height:26px;object-fit:cover;border-radius:4px}
    #imp-status{font-size:.8rem;margin-top:10px;line-height:1.5}
    #imp-status.err{color:#dc2626}
    #imp-status.ok{color:#1b5e20}
    .imp-found{background:#e8f4f8;border-radius:9px;padding:12px 14px;margin-bottom:14px;font-size:.85rem;color:var(--blue)}
    .imp-found b{font-size:1rem}
    .imp-tools{display:flex;justify-content:space-between;align-items:center;font-size:.75rem;color:#888;margin-bottom:8px}
    .imp-tools button{background:none;border:none;color:var(--terracotta);font-weight:600;cursor:pointer;font-family:inherit;font-size:.75rem}
    .imp-item{display:flex;gap:11px;align-items:flex-start;padding:11px 4px;border-bottom:.5px solid var(--mist);cursor:pointer}
    .imp-item:last-child{border-bottom:none}
    .imp-item input{margin-top:4px;width:18px;height:18px;accent-color:var(--terracotta);flex-shrink:0}
    .imp-ico{font-size:1.3rem;line-height:1.2}
    .imp-main{flex:1;min-width:0}
    .imp-name{font-weight:600;font-size:.9rem;color:var(--deep)}
    .imp-cat{display:inline-block;margin-left:6px;background:#f5f0e8;color:var(--slate);border-radius:4px;padding:1px 7px;font-size:.66rem;font-weight:600;vertical-align:2px}
    .imp-note{display:block;font-size:.8rem;color:#5a5550;line-height:1.5;margin-top:2px}
    .imp-geo{display:block;font-size:.7rem;color:#999;margin-top:3px}
    .imp-geo.miss{color:#8a4b00}
    .imp-list-wrap{max-height:52vh;overflow-y:auto;margin-bottom:14px}
  `;
  document.head.appendChild(style);

  // ── Import card inside Voyage Sync ──
  function mountCard() {
    const list = document.getElementById('sync-list');
    if (!list || document.getElementById('imp-card')) return;
    const card = document.createElement('div');
    card.id = 'imp-card';
    card.innerHTML = `
      <div class="imp-title">Import from TikTok</div>
      <div class="imp-sub">Paste a travel video link, or add screenshots from TikTok or Instagram. Every spot it mentions lands here for you to review.</div>
      <div class="imp-row">
        <input id="imp-url" placeholder="Paste a TikTok link" inputmode="url" autocomplete="off">
        <button class="imp-ghost" id="imp-paste" type="button">Paste</button>
      </div>
      <label class="imp-file" id="imp-file-lbl">
        <span>📸</span><span id="imp-file-txt">Add screenshots (optional, up to 5)</span>
        <span class="imp-thumbs" id="imp-thumbs"></span>
        <input type="file" id="imp-files" accept="image/*" multiple hidden>
      </label>
      <button class="syncbtn" id="imp-go" type="button">Find the spots</button>
      <div id="imp-status"></div>`;
    list.parentElement.parentElement.insertBefore(card, list.parentElement);

    document.getElementById('imp-paste').onclick = async () => {
      const input = document.getElementById('imp-url');
      try {
        input.value = (await navigator.clipboard.readText()).trim();
      } catch {
        input.focus();
      }
    };
    document.getElementById('imp-files').onchange = (e) => setFiles([...e.target.files].slice(0, 5));
    document.getElementById('imp-go').onclick = runImport;
  }

  function setFiles(list) {
    files = list;
    const lbl = document.getElementById('imp-file-lbl');
    const thumbs = document.getElementById('imp-thumbs');
    thumbs.innerHTML = '';
    lbl.classList.toggle('has', files.length > 0);
    document.getElementById('imp-file-txt').textContent = files.length
      ? `${files.length} screenshot${files.length > 1 ? 's' : ''} added`
      : 'Add screenshots (optional, up to 5)';
    files.forEach((f) => {
      const img = document.createElement('img');
      img.src = URL.createObjectURL(f);
      thumbs.appendChild(img);
    });
  }

  function status(msg, kind) {
    const el = document.getElementById('imp-status');
    el.className = kind || '';
    el.innerHTML = msg;
  }

  // Downscale on the phone so uploads stay small and fast.
  function shrink(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const max = 1400;
        const s = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * s);
        c.height = Math.round(img.height * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', 0.8).split(',')[1]);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Could not read one of the screenshots'));
      };
      img.src = url;
    });
  }

  // ── Google Places lookup (uses the Maps key already loaded by index.html) ──
  function findPlace(query) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), 8000);
      whenGmapsReady(() => {
        try {
          const svc = new google.maps.places.PlacesService(document.createElement('div'));
          svc.findPlaceFromQuery(
            { query, fields: ['name', 'geometry', 'formatted_address'] },
            (results, st) => {
              clearTimeout(timer);
              const r = results && results[0];
              if (st === google.maps.places.PlacesServiceStatus.OK && r && r.geometry) {
                resolve({
                  name: r.name,
                  address: r.formatted_address || '',
                  lat: r.geometry.location.lat(),
                  lng: r.geometry.location.lng(),
                });
              } else resolve(null);
            }
          );
        } catch {
          clearTimeout(timer);
          resolve(null);
        }
      });
    });
  }

  async function geocodeAll(places) {
    const out = [];
    for (let i = 0; i < places.length; i += 5) {
      const chunk = places.slice(i, i + 5);
      const geos = await Promise.all(chunk.map((p) => findPlace([p.name, p.city, p.country].filter(Boolean).join(', '))));
      chunk.forEach((p, j) => out.push({ ...p, geo: geos[j] }));
    }
    return out;
  }

  // ── Main flow ──
  async function runImport() {
    const s = session();
    if (!s) return status('Start or join a trip first.', 'err');
    const url = document.getElementById('imp-url').value.trim();
    if (!url && !files.length) return status('Paste a TikTok link or add screenshots.', 'err');

    const btn = document.getElementById('imp-go');
    btn.disabled = true;
    btn.textContent = 'Reading the video…';
    status('');

    try {
      const images = await Promise.all(files.map(shrink));
      const d = await api('/api/import-social', { code: s.code, url, images });

      if (!d.places || !d.places.length) {
        status(
          d.source === 'tiktok'
            ? "No named spots in this video's caption. Add 2–3 screenshots where the places are shown and try again."
            : 'No named spots found in those screenshots. Try frames where names are on screen.',
          'err'
        );
        return;
      }

      btn.textContent = `Pinning ${d.places.length} spots…`;
      const located = await geocodeAll(d.places);
      const existing = new Set((s.places || []).map((p) => p.name.toLowerCase()));

      pending = located.map((p) => {
        const displayName = p.geo ? p.geo.name : p.name;
        const dupe = existing.has(displayName.toLowerCase()) || existing.has(p.name.toLowerCase());
        return { ...p, displayName, dupe, icon: CAT_ICONS[p.category] || '📍' };
      });
      sourceLabel = d.source === 'tiktok' ? 'TikTok' : 'screenshots';
      openReview(d.title, d.author);
    } catch (e) {
      status(esc(e.message), 'err');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Find the spots';
    }
  }

  // ── Review sheet ──
  function ensureOverlay() {
    if (document.getElementById('imp-overlay')) return;
    const ov = document.createElement('div');
    ov.id = 'imp-overlay';
    ov.className = 'overlay';
    ov.innerHTML = `
      <div class="modal">
        <div class="mhd">
          <button class="mclose" type="button" id="imp-close">✕</button>
          <div class="mtitle" id="imp-rtitle"></div>
          <div class="mloc" id="imp-rsub"></div>
        </div>
        <div class="mbody">
          <div class="imp-found" id="imp-found"></div>
          <div class="imp-tools"><span id="imp-selcount"></span>
            <span><button type="button" id="imp-all">Select all</button> · <button type="button" id="imp-none">Clear</button></span></div>
          <div class="imp-list-wrap" id="imp-list"></div>
          <button class="syncbtn" type="button" id="imp-add"></button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    ov.addEventListener('click', (e) => { if (e.target === ov) closeReview(); });
    document.getElementById('imp-close').onclick = closeReview;
    document.getElementById('imp-all').onclick = () => setAll(true);
    document.getElementById('imp-none').onclick = () => setAll(false);
    document.getElementById('imp-add').onclick = addSelected;
  }

  function openReview(title, author) {
    ensureOverlay();
    const s = session();
    document.getElementById('imp-rtitle').textContent = title || 'Imported spots';
    document.getElementById('imp-rsub').textContent =
      `From ${sourceLabel}${author ? ' @' + author : ''} → ${s.name}`;
    const pinned = pending.filter((p) => p.geo).length;
    document.getElementById('imp-found').innerHTML =
      `We found <b>${pending.length} spot${pending.length > 1 ? 's' : ''}</b>. ${pinned} pinned on the map. Uncheck anything you don't want, then add.`;

    document.getElementById('imp-list').innerHTML = pending
      .map((p, i) => {
        const checked = p.geo && !p.dupe && p.confidence !== 'low';
        const geoLine = p.dupe
          ? '<span class="imp-geo">Already in this trip</span>'
          : p.geo
          ? `<span class="imp-geo">📍 ${esc(p.geo.address)}</span>`
          : '<span class="imp-geo miss">Not found on the map. Adds without a pin.</span>';
        const lowConf = p.confidence === 'low' ? ' <span class="imp-cat" style="background:#fff3e0;color:#8a4b00">Unsure</span>' : '';
        return `<label class="imp-item">
          <input type="checkbox" data-i="${i}" ${checked ? 'checked' : ''}>
          <span class="imp-ico">${p.icon}</span>
          <span class="imp-main">
            <span class="imp-name">${esc(p.displayName)}</span><span class="imp-cat">${CAT_LABELS[p.category] || 'Other'}</span>${lowConf}
            ${p.note ? `<span class="imp-note">${esc(p.note)}</span>` : ''}
            ${geoLine}
          </span>
        </label>`;
      })
      .join('');
    document.querySelectorAll('#imp-list input').forEach((cb) => (cb.onchange = updateCount));
    updateCount();
    document.getElementById('imp-overlay').classList.add('open');
  }

  function setAll(v) {
    document.querySelectorAll('#imp-list input').forEach((cb) => (cb.checked = v));
    updateCount();
  }
  function updateCount() {
    const n = document.querySelectorAll('#imp-list input:checked').length;
    document.getElementById('imp-selcount').textContent = `${n} selected`;
    const btn = document.getElementById('imp-add');
    btn.textContent = n ? `Add ${n} to trip` : 'Select spots to add';
    btn.disabled = n === 0;
  }
  function closeReview() {
    document.getElementById('imp-overlay')?.classList.remove('open');
  }

  async function addSelected() {
    const s = session();
    const picks = [...document.querySelectorAll('#imp-list input:checked')].map((cb) => pending[+cb.dataset.i]);
    const btn = document.getElementById('imp-add');
    btn.disabled = true;
    btn.textContent = 'Adding…';
    const who = `${s.partner || 'Me'} via ${sourceLabel}`;
    let ok = 0;
    for (const p of picks) {
      try {
        await api('/api/add-trip-place', {
          code: s.code,
          name: p.displayName,
          city: p.city || 'Unknown',
          icon: p.icon,
          addedBy: who,
          lat: p.geo ? p.geo.lat : undefined,
          lng: p.geo ? p.geo.lng : undefined,
        });
        ok++;
      } catch {}
    }
    closeReview();
    document.getElementById('imp-url').value = '';
    setFiles([]);
    document.getElementById('imp-files').value = '';
    const failed = picks.length - ok;
    status(
      `Added ${ok} spot${ok === 1 ? '' : 's'} to ${esc(s.name)}.${failed ? ` ${failed} couldn't be saved; try again.` : ''} Drag them into days in Itinerary.`,
      failed ? 'err' : 'ok'
    );
    await refreshSync();
  }

  // ── Deep link: /?import=<url> opens the trip and runs the import ──
  function handleDeepLink() {
    const params = new URLSearchParams(location.search);
    const link = params.get('import');
    if (!link) return;
    history.replaceState(null, '', location.pathname);
    if (!session()) {
      showTab('sync');
      return;
    }
    showTab('sync');
    document.getElementById('imp-url').value = link;
    runImport();
  }

  mountCard();
  handleDeepLink();
})();
