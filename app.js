// app.js - ZScripts v3 frontend

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

const state = {
  user: null,
  token: localStorage.getItem('token') || null,
  config: { googleEnabled: false, googleClientId: '' },
  customTags: [],
  panels: [],
  pendingFiles: [], // files attached to script being created
};

// ---- Sound engine ----
const AudioCtx = window.AudioContext || window.webkitAudioContext;
let actx = null;
function getACtx() { if (!actx) actx = new AudioCtx(); return actx; }
function playTone(freq, type = 'sine', duration = 0.08, vol = 0.12, fadeIn = 0.005) {
  try {
    const ctx = getACtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = type; osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(vol, ctx.currentTime + fadeIn);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.start(ctx.currentTime); osc.stop(ctx.currentTime + duration);
  } catch(e) {}
}
const sfx = {
  click()    { playTone(600, 'sine', 0.06, 0.08); },
  success()  { playTone(523, 'sine', 0.08, 0.1); setTimeout(() => playTone(784, 'sine', 0.12, 0.1), 80); },
  error()    { playTone(200, 'sawtooth', 0.15, 0.1); },
  open()     { playTone(440, 'sine', 0.06, 0.07); setTimeout(() => playTone(550, 'sine', 0.07, 0.07), 60); },
  close()    { playTone(550, 'sine', 0.05, 0.07); setTimeout(() => playTone(440, 'sine', 0.07, 0.07), 50); },
  install()  { [0,60,120].forEach((d,i) => setTimeout(() => playTone(400 + i*120,'sine',0.1,0.12), d)); },
  copy()     { playTone(700, 'sine', 0.05, 0.08); },
  hover()    { playTone(500, 'sine', 0.03, 0.04); },
  nav()      { playTone(480, 'triangle', 0.07, 0.07); },
  wardrobe() { [0,80,160].forEach((d,i) => setTimeout(() => playTone(300+i*100,'triangle',0.1,0.1), d)); },
};

// ---- Ripple ----
function addRipple(e) {
  const btn = e.currentTarget;
  const rect = btn.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height) * 2;
  const x = e.clientX - rect.left - size / 2;
  const y = e.clientY - rect.top - size / 2;
  const rip = document.createElement('span');
  rip.className = 'ripple-effect';
  rip.style.cssText = `width:${size}px;height:${size}px;left:${x}px;top:${y}px;`;
  btn.appendChild(rip);
  setTimeout(() => rip.remove(), 600);
}
function setupRipples() {
  $$('.ripple').forEach(el => {
    el.removeEventListener('click', addRipple);
    el.addEventListener('click', addRipple);
  });
}

// ---- API ----
async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (state.token) headers['Authorization'] = 'Bearer ' + state.token;
  const res = await fetch('/api' + path, {
    method: opts.method || 'GET',
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function timeAgo(iso) {
  const s = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (s < 60) return s + 's ago';
  if (s < 3600) return Math.floor(s/60) + 'm ago';
  if (s < 86400) return Math.floor(s/3600) + 'h ago';
  return Math.floor(s/86400) + 'd ago';
}

function pfpImg(user, size = 22) {
  if (user?.pfp) return `<img src="${esc(user.pfp)}" width="${size}" height="${size}" style="border-radius:50%;object-fit:cover;"/>`;
  const letter = (user?.displayName || user?.username || '?')[0].toUpperCase();
  return `<div class="pfp-circle" style="width:${size}px;height:${size}px;font-size:${Math.floor(size*0.44)}px;display:flex;align-items:center;justify-content:center;font-weight:700;background:var(--panel2);color:var(--muted);">${letter}</div>`;
}

// ---- Tag rendering (built-in + custom) ----
function tagBadgesHtml(tags, activeTag, customTags, userCustomTags) {
  if (!tags) return '';
  const customTagsMap = {};
  (customTags || state.customTags || []).forEach(t => customTagsMap[t.id] = t);

  // If showing custom tag
  if (activeTag && activeTag.startsWith('custom:')) {
    const ctId = activeTag.slice(7);
    const ct = customTagsMap[ctId];
    if (ct && (userCustomTags || []).includes(ctId)) {
      return renderCustomTagBadge(ct);
    }
  }
  // Built-in active tag
  if (activeTag === 'owner' && tags.owner) return `<span class="tag-badge tag-owner">owner</span>`;
  if (activeTag === 'dev' && tags.dev) return `<span class="tag-badge tag-dev">dev</span>`;
  // No active tag: show best
  if (!activeTag) {
    if (tags.owner) return `<span class="tag-badge tag-owner">owner</span>`;
    if (tags.dev) return `<span class="tag-badge tag-dev">dev</span>`;
    // Show first custom tag user has
    for (const ctId of (userCustomTags || [])) {
      const ct = customTagsMap[ctId];
      if (ct) return renderCustomTagBadge(ct);
    }
  }
  return '';
}

function renderCustomTagBadge(ct) {
  const fontMap = {
    'IBM Plex Mono': "'IBM Plex Mono', monospace",
    'Orbitron': "'Orbitron', sans-serif",
    'Rajdhani': "'Rajdhani', sans-serif",
    'Share Tech Mono': "'Share Tech Mono', monospace",
    'Space Grotesk': "'Space Grotesk', sans-serif",
    'inherit': 'inherit'
  };
  const ff = fontMap[ct.font] || 'inherit';
  const icon = ct.icon ? `<i class="${esc(ct.icon)}" style="margin-right:3px;"></i>` : '';
  return `<span class="tag-badge tag-custom" style="color:${esc(ct.color)};background:${esc(ct.bg)};font-family:${ff};">${icon}${esc(ct.label)}</span>`;
}

function hasAnyTag(user) {
  if (!user) return false;
  return (user.tags && (user.tags.owner || user.tags.dev)) ||
    (user.customTags && user.customTags.length > 0);
}

function esc(str) {
  return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function lineCount(code) { return String(code||'').replace(/\r\n/g,'\n').split('\n').length; }

function codeWithLineNumbers(code, { maxLines = null, variant = '' } = {}) {
  const lines = String(code||'').replace(/\r\n/g,'\n').split('\n');
  const limited = maxLines && lines.length > maxLines;
  const shown = limited ? lines.slice(0, maxLines) : lines;
  const nums = shown.map((_,i) => `<div>${i+1}</div>`).join('');
  const codeLines = shown.map(l => `<div>${esc(l) || '&nbsp;'}</div>`).join('');
  return `<div class="code-view ${variant}${limited ? ' code-view-fade' : ''}">
    <div class="code-gutter">${nums}</div>
    <div class="code-lines">${codeLines}</div>
  </div>`;
}

function fmtBytes(b) {
  if (b < 1024) return b + ' B';
  if (b < 1024*1024) return (b/1024).toFixed(1) + ' KB';
  return (b/(1024*1024)).toFixed(1) + ' MB';
}

// ---- Toast ----
let toastTimer;
function toast(msg, isError = false) {
  const el = $('#toast');
  const icon = el.querySelector('.toast-icon');
  $('#toastMsg').textContent = msg;
  icon.className = 'toast-icon fa-solid ' + (isError ? 'fa-circle-exclamation' : 'fa-circle-check');
  icon.style.color = isError ? 'var(--danger)' : 'var(--good)';
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
  if (isError) sfx.error(); else sfx.success();
}

// ---- Navigation ----
function showView(name) {
  $$('.view').forEach(v => v.classList.add('hidden'));
  const el = $(`#view-${name}`);
  if (el) el.classList.remove('hidden');
  sfx.nav();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

document.addEventListener('click', e => {
  const nav = e.target.closest('[data-nav]');
  if (nav) { sfx.click(); if (nav.dataset.nav === 'home') { showView('home'); loadScripts(); } }
  const close = e.target.closest('[data-close]');
  if (close) { sfx.close(); closeModal(close.dataset.close); }
  if (e.target.classList.contains('modal-backdrop')) { sfx.close(); e.target.id && closeModal(e.target.id); }
  const pill = e.target.closest('.account-pill');
  if (pill) {
    const notMenu = !e.target.closest('.account-menu');
    if (notMenu) { sfx.click(); pill.classList.toggle('open'); }
  } else { $('.account-pill')?.classList.remove('open'); }
  if (e.target.closest('.btn-ghost, .btn-link') && !e.target.closest('[data-nav],[data-close]')) sfx.click();
});

document.addEventListener('mouseover', e => {
  if (e.target.closest('.script-card, .user-row, .top-script-row')) {
    if (!e.target.closest('.script-card')?.dataset.hovering) {
      if (e.target.closest('.script-card')) e.target.closest('.script-card').dataset.hovering = '1';
      sfx.hover();
    }
  }
});
document.addEventListener('mouseout', e => {
  if (e.target.closest('.script-card')) delete e.target.closest('.script-card').dataset.hovering;
});

function openModal(id) { $(`#${id}`)?.classList.remove('hidden'); sfx.open(); setTimeout(setupRipples, 50); }
function closeModal(id) { $(`#${id}`)?.classList.add('hidden'); }

// ---- Auth UI ----
function renderAuthArea() {
  const area = $('#authArea');
  $('#myScriptsBtn').classList.toggle('hidden', !state.user);
  if (!state.user) {
    area.innerHTML = `<button class="btn-ghost ripple" id="loginBtn"><i class="fa-solid fa-right-to-bracket"></i> log in</button>`;
    $('#loginBtn').addEventListener('click', () => openModal('authModalBackdrop'));
  } else {
    const u = state.user;
    const activeBadge = tagBadgesHtml(u.tags, u.activeTag, state.customTags, u.customTags);
    area.innerHTML = `
      <div class="account-pill" id="accountPill">
        ${pfpImg(u, 24)}
        <span>${esc(u.displayName || u.username)}</span>
        ${activeBadge}
        <div class="account-menu">
          <button id="menuProfile"><i class="fa-solid fa-user"></i> my profile</button>
          ${hasAnyTag(u) ? `<button id="menuWardrobe"><i class="fa-solid fa-shirt"></i> wardrobe</button>` : ''}
          ${u.tags?.ownerAccess ? `<button id="menuAdmin"><i class="fa-solid fa-shield-halved"></i> owner panel</button>` : ''}
          <button id="menuLogout"><i class="fa-solid fa-right-from-bracket"></i> log out</button>
        </div>
      </div>`;
    $('#menuProfile').onclick = () => { sfx.click(); loadProfile(u.username); $('.account-pill')?.classList.remove('open'); };
    if (hasAnyTag(u)) $('#menuWardrobe').onclick = () => { openWardrobe(); $('.account-pill')?.classList.remove('open'); };
    if (u.tags?.ownerAccess) $('#menuAdmin').onclick = () => { toggleAdmin(); $('.account-pill')?.classList.remove('open'); };
    $('#menuLogout').onclick = logout;
  }
  setupRipples();
}

// ---- Wardrobe ----
function openWardrobe() {
  const u = state.user;
  if (!u) return;
  sfx.wardrobe();
  const opts = $('#wardrobeOptions');
  opts.innerHTML = '';
  const available = [];
  if (u.tags?.owner) available.push({ key: 'owner', label: 'Owner', cls: 'tag-owner', isBuiltin: true });
  if (u.tags?.dev) available.push({ key: 'dev', label: 'Dev', cls: 'tag-dev', isBuiltin: true });
  // Custom tags user has
  (u.customTags || []).forEach(ctId => {
    const ct = state.customTags.find(t => t.id === ctId);
    if (ct) available.push({ key: 'custom:' + ct.id, label: ct.label, isCustom: true, ct });
  });

  available.forEach(tag => {
    const isActive = u.activeTag === tag.key;
    const div = document.createElement('div');
    div.className = 'wardrobe-option' + (isActive ? ' active' : '');
    let badgeHtml;
    if (tag.isCustom) {
      badgeHtml = renderCustomTagBadge(tag.ct);
    } else {
      badgeHtml = `<span class="tag-badge ${tag.cls}">${tag.label}</span>`;
    }
    div.innerHTML = `<span>${badgeHtml}</span>${isActive ? '<span class="wardrobe-equipped"><i class="fa-solid fa-check"></i> equipped</span>' : ''}`;
    div.onclick = () => equipTag(tag.key);
    opts.appendChild(div);
  });

  const none = document.createElement('div');
  none.className = 'wardrobe-none';
  none.innerHTML = `<i class="fa-solid fa-ban" style="color:var(--muted);"></i> ${u.activeTag ? 'unequip tag' : 'no tag equipped'}`;
  none.onclick = () => equipTag(null);
  opts.appendChild(none);
  openModal('wardrobeModalBackdrop');
}

async function equipTag(tagKey) {
  try {
    const data = await api('/me', { method: 'PUT', body: { activeTag: tagKey } });
    state.user = data.user;
    localStorage.setItem('user', JSON.stringify(state.user));
    renderAuthArea();
    closeModal('wardrobeModalBackdrop');
    toast(tagKey ? `equipped: ${tagKey.startsWith('custom:') ? 'custom tag' : tagKey}` : 'tag unequipped');
  } catch (e) { toast(e.message, true); }
}

function logout() {
  sfx.click();
  state.token = null; state.user = null;
  localStorage.removeItem('token'); localStorage.removeItem('user');
  renderAuthArea();
  showView('home'); loadScripts();
  toast('logged out');
}

// ---- Google ----
async function fetchGoogleConfig() { try { state.config = await api('/config'); } catch(e) {} }
function renderGoogleButton() {
  if (!state.config.googleEnabled || !state.config.googleClientId) return;
  if (!window.google?.accounts) return;
  const area = $('#googleLoginArea');
  if (!area) return;
  area.classList.remove('hidden');
  google.accounts.id.initialize({
    client_id: state.config.googleClientId,
    callback: async (response) => {
      try {
        const data = await api('/google-login', { method: 'POST', body: { idToken: response.credential } });
        onLoggedIn(data);
      } catch (err) { toast(err.message, true); }
    }
  });
  google.accounts.id.renderButton($('#googleBtnContainer'), { theme:'filled_black', size:'large', width:300 });
}
async function setupGoogle() {
  await fetchGoogleConfig();
  if (window._googleLibraryLoaded) renderGoogleButton();
  else window._googleReadyCb = renderGoogleButton;
}
function onLoggedIn(data) {
  state.token = data.token; state.user = data.user;
  localStorage.setItem('token', data.token);
  localStorage.setItem('user', JSON.stringify(data.user));
  renderAuthArea();
  closeModal('authModalBackdrop');
  toast(`welcome, ${data.user.displayName || data.user.username}!`);
}

// ---- Auth forms ----
$('#loginForm').onsubmit = async e => {
  e.preventDefault(); $('#loginError').textContent = '';
  try {
    onLoggedIn(await api('/login', { method:'POST', body:{ email:$('#loginEmail').value, password:$('#loginPassword').value }}));
  } catch (err) { $('#loginError').innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> ${esc(err.message)}`; sfx.error(); }
};
$('#registerForm').onsubmit = async e => {
  e.preventDefault(); $('#registerError').textContent = '';
  try {
    onLoggedIn(await api('/register', { method:'POST', body:{ username:$('#registerUsername').value, email:$('#registerEmail').value, password:$('#registerPassword').value }}));
  } catch (err) { $('#registerError').innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> ${esc(err.message)}`; sfx.error(); }
};
$$('.tab').forEach(tab => {
  tab.onclick = () => {
    sfx.click();
    $$('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    const which = tab.dataset.tab;
    $('#loginForm').classList.toggle('hidden', which !== 'login');
    $('#registerForm').classList.toggle('hidden', which !== 'register');
  };
});

// ---- File upload handling ----
function setupFileUpload() {
  const dropZone = $('#fileDropZone');
  const fileInput = $('#fileInput');

  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault(); dropZone.classList.remove('drag-over');
    handleFiles([...e.dataTransfer.files]);
  });
  fileInput.addEventListener('change', () => handleFiles([...fileInput.files]));
}

function handleFiles(newFiles) {
  const remaining = 5 - state.pendingFiles.length;
  if (remaining <= 0) { toast('max 5 files', true); return; }
  const toAdd = newFiles.slice(0, remaining);
  const readers = toAdd.map(file => new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ name: file.name, data: reader.result, type: file.type, size: file.size });
    reader.readAsDataURL(file);
  }));
  Promise.all(readers).then(loaded => {
    state.pendingFiles = [...state.pendingFiles, ...loaded];
    renderFileList();
  });
}

function renderFileList() {
  const el = $('#fileList');
  if (!el) return;
  if (!state.pendingFiles.length) { el.innerHTML = ''; return; }
  el.innerHTML = state.pendingFiles.map((f, i) => `
    <div class="file-item">
      <i class="fa-solid fa-file file-item-icon"></i>
      <span class="file-item-name">${esc(f.name)}</span>
      <span class="file-item-size muted small">${fmtBytes(f.size)}</span>
      <button class="file-item-remove" data-idx="${i}" title="remove"><i class="fa-solid fa-xmark"></i></button>
    </div>`).join('');
  el.querySelectorAll('.file-item-remove').forEach(btn => {
    btn.onclick = () => {
      sfx.click();
      state.pendingFiles.splice(parseInt(btn.dataset.idx), 1);
      renderFileList();
    };
  });
}

// ---- Scripts ----
async function loadScripts(search = '') {
  try {
    const data = await api('/scripts' + (search ? `?search=${encodeURIComponent(search)}` : ''));
    renderScripts(data.scripts);
    loadSidebar();
  } catch (e) { toast('could not load scripts', true); }
}

// ---- Sidebar (replaces old news + top scripts) ----
async function loadSidebar() {
  try {
    const [panelsData, settingsData, topData, customTagsData] = await Promise.all([
      api('/panels').catch(() => ({ panels: [] })),
      api('/settings').catch(() => ({ settings: {} })),
      api('/scripts/top').catch(() => ({ scripts: [] })),
      api('/custom-tags').catch(() => ({ tags: [] })),
    ]);
    state.panels = panelsData.panels || [];
    state.customTags = customTagsData.tags || [];
    renderSidebar(panelsData.panels, settingsData.settings, topData.scripts);
  } catch(e) {}
}

function renderSidebar(panels, settings, topScripts) {
  const el = $('#sidebarPanels');
  if (!el) return;
  el.innerHTML = '';

  // Always-on: site news
  const newsPanel = document.createElement('div');
  newsPanel.className = 'sidebar-block';
  const news = settings?.news || [];
  const newsItems = news.length
    ? news.map(n => `<div class="news-item"><div class="news-text">${esc(n.text)}</div>${n.date?`<div class="news-date"><i class="fa-regular fa-clock" style="font-size:9px;"></i> ${esc(n.date)}</div>`:''}</div>`).join('')
    : `<div class="news-item"><div class="news-text">${esc(settings?.latestUpdate||'Welcome to ZScripts!')}</div></div>`;
  newsPanel.innerHTML = `
    <div class="sidebar-title"><span class="dot dot-live"></span> site news</div>
    <div class="news-feed">${newsItems}</div>`;
  el.appendChild(newsPanel);

  // Always-on: top scripts
  const topPanel = document.createElement('div');
  topPanel.className = 'sidebar-block';
  topPanel.innerHTML = `
    <div class="sidebar-title"><i class="fa-solid fa-trophy" style="color:var(--accent);font-size:10px;"></i> top scripts</div>
    <div class="top-scripts-list" id="topScriptsList">
      ${!topScripts.length ? '<p class="muted small" style="padding:10px 12px;">no scripts yet</p>' :
        topScripts.map((s,i) => {
          const rankClass = i===0?'gold':i===1?'silver':i===2?'bronze':'';
          const rankIcon = i===0?'🥇':i===1?'🥈':i===2?'🥉':`#${i+1}`;
          return `<div class="top-script-row" data-id="${s.id}">
            <span class="top-script-rank ${rankClass}">${rankIcon}</span>
            <div class="top-script-info">
              <div class="top-script-title">${esc(s.title)}</div>
              <div class="top-script-installs"><i class="fa-solid fa-download" style="font-size:9px;"></i> ${s.installs||0}</div>
            </div>
          </div>`;
        }).join('')}
    </div>`;
  el.appendChild(topPanel);
  topPanel.querySelectorAll('.top-script-row').forEach(row => {
    row.onclick = () => { sfx.click(); loadScriptDetail(row.dataset.id); };
  });

  // Custom panels (enabled, sorted by order)
  const enabled = (panels || []).filter(p => p.enabled).sort((a,b) => a.order - b.order);
  enabled.forEach(panel => {
    const block = buildSidebarPanel(panel, topScripts, settings);
    if (block) el.appendChild(block);
  });

  // Always-on: credits / about
  const credits = document.createElement('div');
  credits.className = 'sidebar-block sidebar-credits';
  credits.innerHTML = `
    <div class="sidebar-title"><i class="fa-solid fa-circle-info" style="color:var(--accent2);font-size:10px;"></i> about</div>
    <div class="credits-content">
      <div class="credits-brand">
        <span class="credits-z">Z</span><span class="credits-rest">Scripts</span>
      </div>
      <p class="credits-tagline">a community script catalog for VR devs &amp; creators.</p>
      <div class="credits-divider"></div>
      <div class="credits-row"><i class="fa-solid fa-code"></i> built by <strong>Z3N0</strong></div>
      <div class="credits-row"><i class="fa-solid fa-layer-group"></i> powered by Node.js + MongoDB</div>
      <div class="credits-row version-row"><i class="fa-solid fa-tag"></i> <span id="sidebarVersion">v${esc(settings?.version||'?')}</span></div>
      <div class="credits-divider"></div>
      <div class="credits-links">
        <button class="credits-link" id="creditsUpdatesBtn"><i class="fa-solid fa-bolt"></i> changelog</button>
      </div>
    </div>`;
  el.appendChild(credits);
  credits.querySelector('#creditsUpdatesBtn').onclick = () => {
    sfx.click();
    $('#updatesBtn').click();
  };
}

function buildSidebarPanel(panel, topScripts, settings) {
  const block = document.createElement('div');
  block.className = 'sidebar-block';
  const { type, title, config } = panel;

  if (type === 'announcements') {
    const items = (config.items || []);
    block.innerHTML = `
      <div class="sidebar-title"><i class="fa-solid fa-bullhorn" style="color:var(--accent);font-size:10px;"></i> ${esc(title)}</div>
      <div class="panel-announcements">
        ${items.map(item => `
          <div class="announcement-item ${item.pinned?'pinned':''}">
            ${item.pinned?`<i class="fa-solid fa-thumbtack pin-icon"></i>`:''}
            <div class="announcement-text">${esc(item.text)}</div>
            ${item.date?`<div class="news-date">${esc(item.date)}</div>`:''}
          </div>`).join('') || '<p class="muted small" style="padding:8px 12px;">no announcements</p>'}
      </div>`;
  } else if (type === 'links') {
    const links = (config.links || []);
    block.innerHTML = `
      <div class="sidebar-title"><i class="fa-solid fa-link" style="color:var(--accent2);font-size:10px;"></i> ${esc(title)}</div>
      <div class="panel-links">
        ${links.map(l => `<a class="panel-link-item" href="${esc(l.url)}" target="_blank" rel="noopener">
          ${l.icon?`<i class="${esc(l.icon)}"></i>`:''}${esc(l.label)}<i class="fa-solid fa-arrow-up-right-from-square" style="font-size:9px;margin-left:auto;opacity:0.4;"></i>
        </a>`).join('') || '<p class="muted small" style="padding:8px 12px;">no links</p>'}
      </div>`;
  } else if (type === 'countdown') {
    const target = config.target ? new Date(config.target) : null;
    let countdownHtml = '';
    if (target && !isNaN(target)) {
      const diff = target - Date.now();
      if (diff > 0) {
        const d = Math.floor(diff/86400000);
        const h = Math.floor((diff%86400000)/3600000);
        const m = Math.floor((diff%3600000)/60000);
        countdownHtml = `<div class="countdown-display">
          <div class="countdown-unit"><span class="countdown-num">${d}</span><span class="countdown-label">days</span></div>
          <span class="countdown-sep">:</span>
          <div class="countdown-unit"><span class="countdown-num">${h}</span><span class="countdown-label">hrs</span></div>
          <span class="countdown-sep">:</span>
          <div class="countdown-unit"><span class="countdown-num">${m}</span><span class="countdown-label">min</span></div>
        </div>`;
      } else {
        countdownHtml = `<p class="muted small" style="padding:8px 12px;color:var(--good);">🎉 time's up!</p>`;
      }
    } else {
      countdownHtml = `<p class="muted small" style="padding:8px 12px;">no target date set</p>`;
    }
    block.innerHTML = `
      <div class="sidebar-title"><i class="fa-solid fa-hourglass-half" style="color:var(--accent);font-size:10px;"></i> ${esc(title)}</div>
      ${config.label?`<p class="muted small" style="padding:4px 12px 0;">${esc(config.label)}</p>`:''}
      ${countdownHtml}`;
  } else if (type === 'stats') {
    block.innerHTML = `
      <div class="sidebar-title"><i class="fa-solid fa-chart-bar" style="color:var(--accent2);font-size:10px;"></i> ${esc(title)}</div>
      <div class="panel-stats" id="statsPanel_${panel.id}">
        <div class="stat-item"><span class="stat-num" id="statScripts">—</span><span class="stat-label">scripts</span></div>
        <div class="stat-item"><span class="stat-num" id="statUsers">—</span><span class="stat-label">users</span></div>
        <div class="stat-item"><span class="stat-num" id="statInstalls">—</span><span class="stat-label">total installs</span></div>
      </div>`;
    // Load stats async
    Promise.all([api('/scripts'), api('/users')]).then(([scripts, users]) => {
      const totalInstalls = (scripts.scripts||[]).reduce((a,s) => a + (s.installs||0), 0);
      const sEl = document.getElementById(`statsPanel_${panel.id}`);
      if (sEl) {
        sEl.querySelector('#statScripts').textContent = scripts.scripts?.length || 0;
        sEl.querySelector('#statUsers').textContent = users.users?.length || 0;
        sEl.querySelector('#statInstalls').textContent = totalInstalls;
      }
    }).catch(() => {});
  } else if (type === 'custom') {
    block.innerHTML = `
      <div class="sidebar-title">${config.icon?`<i class="${esc(config.icon)}" style="font-size:10px;color:var(--accent);"></i> `:''} ${esc(title)}</div>
      <div class="panel-custom-content">${esc(config.content||'')}</div>`;
  } else {
    return null;
  }
  return block;
}

function renderScripts(scripts) {
  const grid = $('#scriptsGrid');
  const empty = $('#scriptsEmpty');
  if (!scripts.length) { grid.innerHTML=''; empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');
  grid.innerHTML = scripts.map((s,i) => {
    const tagsHtml = (s.tags||[]).slice(0,3).map(t=>`<span class="tag-pill">${esc(t)}</span>`).join('');
    const authorBadge = tagBadgesHtml(s.author?.tags, s.author?.activeTag, state.customTags, s.author?.customTags);
    return `<div class="script-card" data-id="${s.id}" style="animation-delay:${i*0.04}s">
      <div class="script-card-top">
        <h3>${esc(s.title)}</h3>
        <div class="script-card-meta">
          ${s.allowCopy===false?'<i class="fa-solid fa-lock lock-badge" title="copy/download disabled"></i>':''}
          ${s.language?`<span class="lang">${esc(s.language)}</span>`:''}
        </div>
      </div>
      ${s.description?`<p>${esc(s.description)}</p>`:''}
      <div class="mini-dots"><span></span><span></span><span></span><span class="mini-dots-lines">${lineCount(s.code)} lines</span></div>
      ${codeWithLineNumbers(s.code, { maxLines:5, variant:'code-view-preview' })}
      ${tagsHtml?`<div class="script-card-tags">${tagsHtml}</div>`:''}
      <div class="card-footer">
        ${pfpImg(s.author,15)}
        <span>${esc(s.author?.displayName||s.author?.username||'unknown')}</span>
        ${authorBadge}
        <span>· ${timeAgo(s.createdAt)}</span>
        <span class="installs"><i class="fa-solid fa-download" style="font-size:9px;"></i> ${s.installs||0}</span>
      </div>
    </div>`;
  }).join('');
  grid.querySelectorAll('.script-card').forEach(card => {
    card.onclick = () => { sfx.click(); loadScriptDetail(card.dataset.id); };
  });
}

async function loadScriptDetail(id) {
  showView('script');
  try {
    const data = await api(`/scripts/${id}`);
    renderScriptDetail(data.script);
  } catch(e) { toast('could not load script', true); showView('home'); }
}

function renderScriptDetail(s) {
  const el = $('#scriptDetail');
  const isOwn = state.user && s.author?.id === state.user.id;
  const isAdmin = state.user?.tags?.ownerAccess;
  const canBypassLock = isOwn || isAdmin;
  const locked = s.allowCopy === false;
  const tagsHtml = (s.tags||[]).map(t=>`<span class="tag-pill">${esc(t)}</span>`).join('');
  const authorBadge = tagBadgesHtml(s.author?.tags, s.author?.activeTag, state.customTags, s.author?.customTags);
  const filesHtml = (s.files||[]).length ? `
    <div class="script-files">
      <div class="script-files-title"><i class="fa-solid fa-paperclip"></i> attached files</div>
      ${s.files.map(f => `
        <div class="script-file-row">
          <i class="fa-solid fa-file"></i>
          <span class="script-file-name">${esc(f.name)}</span>
          <span class="muted small">${fmtBytes(f.size)}</span>
          ${(!locked||canBypassLock)?`<button class="btn-ghost btn-sm file-download-btn" data-name="${esc(f.name)}" data-type="${esc(f.type)}" data-data="${esc(f.data)}">
            <i class="fa-solid fa-download"></i> download
          </button>`:'<span class="muted small"><i class="fa-solid fa-lock"></i></span>'}
        </div>`).join('')}
    </div>` : '';

  el.innerHTML = `
    <div class="script-detail-head">
      <div>
        <h1>${esc(s.title)}</h1>
        ${s.description?`<p style="color:var(--muted);font-size:13px;margin-top:4px;">${esc(s.description)}</p>`:''}
        <div class="script-author" data-username="${esc(s.author?.username||'')}">
          ${pfpImg(s.author,20)}
          <span>${esc(s.author?.displayName||s.author?.username||'unknown')}</span>
          ${authorBadge}
          · <span style="color:var(--muted);">${timeAgo(s.createdAt)}</span>
        </div>
        <div class="install-count"><i class="fa-solid fa-download"></i> ${s.installs||0} installs</div>
        ${tagsHtml?`<div style="margin-top:8px;display:flex;gap:4px;flex-wrap:wrap;">${tagsHtml}</div>`:''}
      </div>
      <div class="script-detail-actions">
        ${(!locked||canBypassLock)?`
          <button class="btn-install ripple" id="installBtn"><i class="fa-solid fa-download"></i> install</button>
          <button class="btn-ghost ripple" id="copyBtn"><i class="fa-regular fa-copy"></i> copy</button>
        `:`<span class="lock-note muted small"><i class="fa-solid fa-lock"></i> creator disabled copying &amp; downloading</span>`}
        ${isOwn||isAdmin?`<button class="btn-ghost ripple" id="editScriptBtn"><i class="fa-solid fa-pen"></i> edit</button>`:''}
        ${isOwn||isAdmin?`<button class="btn-danger ripple" id="deleteScriptBtn"><i class="fa-solid fa-trash"></i> delete</button>`:''}
      </div>
      ${locked&&canBypassLock?`<div class="lock-note muted small" style="width:100%;"><i class="fa-solid fa-lock"></i> copy/download is disabled for everyone else on this script</div>`:''}
    </div>
    ${filesHtml}
    <div class="code-window">
      <div class="code-window-bar">
        <span class="win-dot win-red"></span><span class="win-dot win-yellow"></span><span class="win-dot win-green"></span>
        <span class="code-window-title">${esc((s.title||'script').toLowerCase().replace(/[^a-z0-9_\-]/g,'_'))}.${langToExt(s.language||'txt')}</span>
        <span class="code-window-lines muted small">${lineCount(s.code)} lines</span>
      </div>
      ${codeWithLineNumbers(s.code, { variant:'code-view-full' })}
    </div>`;

  setupRipples();
  el.querySelector('.script-author').onclick = () => { if (s.author?.username) loadProfile(s.author.username); };

  // File downloads
  el.querySelectorAll('.file-download-btn').forEach(btn => {
    btn.onclick = () => {
      sfx.copy();
      const a = document.createElement('a');
      a.href = btn.dataset.data;
      a.download = btn.dataset.name;
      a.click();
      toast('downloading: ' + btn.dataset.name);
    };
  });

  if (!locked || canBypassLock) {
    $('#installBtn').onclick = async () => {
      sfx.install();
      try { await api(`/scripts/${s.id}/install`, { method:'POST' }); } catch(e) { toast(e.message, true); return; }
      const ext = langToExt(s.language||'txt');
      const blob = new Blob([s.code], { type:'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = (s.title||'script').replace(/[^a-z0-9_\-]/gi,'_') + '.' + ext;
      a.click(); URL.revokeObjectURL(url);
      toast('downloading: ' + a.download);
      s.installs = (s.installs||0) + 1;
      el.querySelector('.install-count').innerHTML = `<i class="fa-solid fa-download"></i> ${s.installs} installs`;
    };
    $('#copyBtn').onclick = () => {
      sfx.copy();
      navigator.clipboard.writeText(s.code).then(() => toast('copied to clipboard!'));
    };
  }
  if (isOwn||isAdmin) {
    $('#editScriptBtn').onclick = () => { sfx.click(); openScriptModal(s); };
    $('#deleteScriptBtn').onclick = async () => {
      if (!confirm('Delete this script?')) return;
      try {
        await api(`/scripts/${s.id}`, { method:'DELETE' });
        toast('script deleted'); showView('home'); loadScripts();
      } catch(err) { toast(err.message, true); }
    };
  }
}

function langToExt(lang) {
  const map = {python:'py',py:'py',javascript:'js',js:'js',typescript:'ts',ts:'ts',lua:'lua',bash:'sh',shell:'sh',sh:'sh',ruby:'rb',go:'go',rust:'rs',java:'java',cpp:'cpp',c:'c',cs:'cs',php:'php',html:'html',css:'css',json:'json',yaml:'yml',toml:'toml',sql:'sql',r:'r',swift:'swift',kotlin:'kt',dart:'dart',perl:'pl'};
  return map[lang?.toLowerCase()]||'txt';
}

// ---- Script modal ----
$('#createScriptBtn').onclick = () => {
  if (!state.user) { openModal('authModalBackdrop'); return; }
  openScriptModal(null);
};
function openScriptModal(script) {
  state.pendingFiles = script?.files ? [...script.files] : [];
  $('#scriptFormId').value = script?.id||'';
  $('#scriptModalTitle').innerHTML = `<i class="fa-solid fa-code" style="color:var(--accent);"></i> ${script?'edit script':'create script'}`;
  $('#scriptTitle').value = script?.title||'';
  $('#scriptLanguage').value = script?.language||'';
  $('#scriptDescription').value = script?.description||'';
  $('#scriptTags').value = (script?.tags||[]).join(', ');
  $('#scriptCode').value = script?.code||'';
  $('#scriptAllowCopy').checked = script ? (script.allowCopy !== false) : true;
  $('#scriptFormError').textContent = '';
  renderFileList();
  openModal('scriptModalBackdrop');
}
$('#scriptForm').onsubmit = async e => {
  e.preventDefault(); $('#scriptFormError').textContent = '';
  const id = $('#scriptFormId').value;
  const body = {
    title:$('#scriptTitle').value, language:$('#scriptLanguage').value,
    description:$('#scriptDescription').value,
    tags:$('#scriptTags').value.split(',').map(t=>t.trim()).filter(Boolean),
    code:$('#scriptCode').value,
    allowCopy:$('#scriptAllowCopy').checked,
    files: state.pendingFiles,
  };
  try {
    const data = id ? await api(`/scripts/${id}`,{method:'PUT',body}) : await api('/scripts',{method:'POST',body});
    closeModal('scriptModalBackdrop');
    state.pendingFiles = [];
    toast(id?'script updated!':'script created!');
    if (id) renderScriptDetail(data.script);
    else { showView('home'); loadScripts(); }
  } catch(err) { $('#scriptFormError').innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> ${esc(err.message)}`; sfx.error(); }
};

$('#scriptSearchForm').onsubmit = e => { e.preventDefault(); sfx.click(); loadScripts($('#scriptSearchInput').value.trim()); };
$('#myScriptsBtn').onclick = () => {
  sfx.click();
  if (!state.user) { openModal('authModalBackdrop'); return; }
  loadProfile(state.user.username);
};

// ---- Users ----
$('#searchUsersBtn').onclick = () => { showView('users'); loadUsers(''); };
$('#userSearchForm').onsubmit = e => { e.preventDefault(); sfx.click(); loadUsers($('#userSearchInput').value.trim()); };
async function loadUsers(search) {
  try {
    const data = await api('/users'+(search?`?search=${encodeURIComponent(search)}`:''));
    const el = $('#usersList');
    if (!data.users.length) { el.innerHTML='<p class="muted small">no users found</p>'; return; }
    el.innerHTML = data.users.map((u,i)=>`
      <div class="user-row" data-username="${esc(u.username)}" style="animation-delay:${i*0.04}s">
        ${pfpImg(u,30)}
        <span class="uname">${esc(u.displayName||u.username)}</span>
        <span class="muted small">@${esc(u.username)}</span>
        ${tagBadgesHtml(u.tags,u.activeTag,state.customTags,u.customTags)}
      </div>`).join('');
    el.querySelectorAll('.user-row').forEach(row => {
      row.onclick = () => { sfx.click(); loadProfile(row.dataset.username); };
    });
  } catch(e) { toast('could not load users', true); }
}

// ---- Profile ----
async function loadProfile(username) {
  showView('profile');
  try {
    const data = await api(`/users/${username}`);
    renderProfile(data.user, data.scripts);
  } catch(e) { toast('user not found', true); showView('home'); }
}
function renderProfile(user, scripts) {
  const isOwn = state.user?.id === user.id;
  const el = $('#profileContent');
  const badge = tagBadgesHtml(user.tags, user.activeTag, state.customTags, user.customTags);
  el.innerHTML = `
    <div class="profile-head">
      ${pfpImg(user, 56)}
      <div style="flex:1;">
        <div class="profile-name-row">
          <h1>${esc(user.displayName||user.username)}</h1>
          ${badge}
        </div>
        <p class="muted small">@${esc(user.username)}</p>
        ${user.bio?`<p class="profile-bio">${esc(user.bio)}</p>`:''}
      </div>
      ${isOwn?`<button class="btn-ghost ripple" id="editProfileBtn"><i class="fa-solid fa-pen"></i> edit profile</button>`:''}
    </div>
    ${isOwn?`<div id="editProfileArea" class="hidden"></div>`:''}
    <div class="profile-scripts">
      <h2><i class="fa-solid fa-code" style="color:var(--accent2);"></i> scripts <span class="view-tag">${scripts.length}</span></h2>
      ${scripts.length?`<div class="scripts-grid" id="profileScriptsGrid"></div>`:'<p class="muted small">no scripts yet</p>'}
    </div>`;
  if (scripts.length) {
    const grid = el.querySelector('#profileScriptsGrid');
    grid.innerHTML = scripts.map((s,i)=>`
      <div class="script-card" data-id="${s.id}" style="animation-delay:${i*0.04}s">
        <div class="script-card-top">
          <h3>${esc(s.title)}</h3>
          <div class="script-card-meta">
            ${s.allowCopy===false?'<i class="fa-solid fa-lock lock-badge" title="copy/download disabled"></i>':''}
            ${s.language?`<span class="lang">${esc(s.language)}</span>`:''}
          </div>
        </div>
        ${s.description?`<p>${esc(s.description)}</p>`:''}
        <div class="mini-dots"><span></span><span></span><span></span><span class="mini-dots-lines">${lineCount(s.code)} lines</span></div>
        ${codeWithLineNumbers(s.code, { maxLines:4, variant:'code-view-preview' })}
        <div class="card-footer">
          <span>${timeAgo(s.createdAt)}</span>
          <span class="installs"><i class="fa-solid fa-download" style="font-size:9px;"></i> ${s.installs||0}</span>
        </div>
      </div>`).join('');
    grid.querySelectorAll('.script-card').forEach(card => {
      card.onclick = () => { sfx.click(); loadScriptDetail(card.dataset.id); };
    });
  }
  setupRipples();
  if (isOwn) el.querySelector('#editProfileBtn').onclick = () => renderProfileEdit(el.querySelector('#editProfileArea'));
}
function renderProfileEdit(area) {
  const u = state.user;
  area.classList.toggle('hidden');
  if (!area.classList.contains('hidden') && !area.innerHTML.trim()) {
    area.innerHTML = `
      <div class="profile-edit-area">
        <h2><i class="fa-solid fa-pen" style="color:var(--accent2);"></i> edit profile</h2>
        <div class="profile-edit-field"><label>display name</label><input id="editDisplayName" value="${esc(u.displayName||u.username)}" maxlength="40" /></div>
        <div class="profile-edit-field"><label>bio</label><textarea id="editBio" rows="3" maxlength="280">${esc(u.bio||'')}</textarea></div>
        <div class="profile-edit-field"><label>profile picture</label><input type="file" id="editPfpFile" accept="image/*" /></div>
        <div style="display:flex;gap:8px;margin-top:4px;flex-wrap:wrap;">
          <button class="btn-primary ripple" id="saveProfileBtn"><i class="fa-solid fa-floppy-disk"></i> save</button>
          ${hasAnyTag(u)?`<button class="btn-wardrobe ripple" id="profileWardrobeBtn"><i class="fa-solid fa-shirt"></i> wardrobe</button>`:''}
        </div>
        <p class="form-error" id="profileEditError"></p>
      </div>`;
    setupRipples();
    $('#saveProfileBtn').onclick = async () => {
      const updates = { displayName:$('#editDisplayName').value, bio:$('#editBio').value };
      const file = $('#editPfpFile').files[0];
      if (file) updates.pfp = await new Promise((res,rej) => { const r=new FileReader(); r.onload=()=>res(r.result); r.onerror=rej; r.readAsDataURL(file); });
      try {
        const data = await api('/me',{method:'PUT',body:updates});
        state.user = data.user; localStorage.setItem('user',JSON.stringify(state.user));
        renderAuthArea(); loadProfile(state.user.username); toast('profile updated!');
      } catch(err) { $('#profileEditError').innerHTML=`<i class="fa-solid fa-triangle-exclamation"></i> ${esc(err.message)}`; sfx.error(); }
    };
    if (hasAnyTag(u)) $('#profileWardrobeBtn').onclick = openWardrobe;
  }
}

// ---- Updates ----
$('#updatesBtn').onclick = async () => {
  sfx.click();
  try {
    const data = await api('/settings');
    $('#updatesVersion').textContent = data.settings?.version||'-';
    $('#updatesText').textContent = data.settings?.latestUpdate||'';
    openModal('updatesModalBackdrop');
  } catch(e) { toast('could not load updates', true); }
};

// ---- Admin ----
let adminVisible = false;
function toggleAdmin() {
  const panel = $('#adminPanel');
  adminVisible = !adminVisible;
  panel.classList.toggle('hidden', !adminVisible);
  if (adminVisible) {
    sfx.open();
    // Patch extra tabs once
    if (!window._adminPatched) { window._adminPatched = true; setTimeout(patchAdminTabs, 80); }
    loadAdminUsers();
  }
}
document.addEventListener('keydown', e => {
  if (e.key==='o'||e.key==='O') {
    if (document.activeElement.tagName==='INPUT'||document.activeElement.tagName==='TEXTAREA') return;
    if (state.user?.tags?.ownerAccess) toggleAdmin();
  }
});
$('#adminCloseBtn').onclick = () => { adminVisible=false; sfx.close(); $('#adminPanel').classList.add('hidden'); };
$('#adminFullscreenBtn').onclick = () => { sfx.click(); $('#adminPanel').classList.toggle('fullscreen'); };

const handle = $('#adminDragHandle');
let dragging=false,dragOX,dragOY;
handle.addEventListener('mousedown', e => {
  const p=$('#adminPanel'); if(p.classList.contains('fullscreen')) return;
  dragging=true; dragOX=e.clientX-p.offsetLeft; dragOY=e.clientY-p.offsetTop;
});
document.addEventListener('mousemove', e => {
  if (!dragging) return;
  const p=$('#adminPanel'); p.style.left=(e.clientX-dragOX)+'px'; p.style.top=(e.clientY-dragOY)+'px';
});
document.addEventListener('mouseup', ()=>dragging=false);

$$('.admin-tab').forEach(tab => {
  tab.onclick = () => {
    sfx.click(); $$('.admin-tab').forEach(t=>t.classList.remove('active')); tab.classList.add('active');
    const which = tab.dataset.admintab;
    if (which==='users') loadAdminUsers();
    else if (which==='create') loadAdminCreate();
    else loadAdminSettings();
  };
});

async function loadAdminUsers(search='') {
  const body=$('#adminBody');
  body.innerHTML=`<div class="admin-search-row"><input id="adminUserSearch" placeholder="search users..." value="${esc(search)}" /><button id="adminUserSearchBtn">search</button></div><div id="adminUsersList">loading...</div>`;
  $('#adminUserSearchBtn').onclick=()=>loadAdminUsers($('#adminUserSearch').value.trim());
  $('#adminUserSearch').onkeydown=e=>{if(e.key==='Enter')loadAdminUsers($('#adminUserSearch').value.trim());};
  try {
    const [usersData, customTagsData] = await Promise.all([
      api('/admin/users'+(search?`?search=${encodeURIComponent(search)}`:''), {}),
      api('/custom-tags').catch(() => ({ tags: [] }))
    ]);
    state.customTags = customTagsData.tags || [];
    const list=$('#adminUsersList');
    list.innerHTML=usersData.users.map(u=>`
      <div class="admin-user-row" data-id="${u.id}">
        ${pfpImg(u,24)}
        <span>${esc(u.displayName||u.username)}</span>
        <span class="muted small">@${esc(u.username)}</span>
        ${tagBadgesHtml(u.tags,u.activeTag,state.customTags,u.customTags)}
        ${u.banned?'<span class="banned-flag"><i class="fa-solid fa-ban"></i> BANNED</span>':''}
      </div>`).join('');
    list.querySelectorAll('.admin-user-row').forEach(row=>{ row.onclick=()=>{ sfx.click(); loadAdminUserDetail(row.dataset.id); }; });
  } catch(e) { $('#adminUsersList').textContent='error loading users'; }
}

async function loadAdminUserDetail(id) {
  const body=$('#adminBody'); body.innerHTML='loading...';
  try {
    const [data, customTagsData] = await Promise.all([
      api(`/admin/users/${id}`),
      api('/custom-tags').catch(() => ({ tags: [] }))
    ]);
    const u=data.user, scripts=data.scripts;
    const allCustomTags = customTagsData.tags || [];
    state.customTags = allCustomTags;
    const userCustomTagIds = u.customTags || [];

    const customTagsCheckboxes = allCustomTags.map(ct => {
      const has = userCustomTagIds.includes(ct.id);
      return `<div class="admin-custom-tag-row">
        <label><input type="checkbox" class="ctag-check" data-tagid="${esc(ct.id)}" ${has?'checked':''}> ${renderCustomTagBadge(ct)} — <span class="muted small">${esc(ct.label)}</span></label>
      </div>`;
    }).join('') || '<span class="muted small">no custom tags created yet</span>';

    body.innerHTML=`
      <button class="admin-detail-back" id="adminBack"><i class="fa-solid fa-arrow-left"></i> back</button>
      <div class="admin-detail-card">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
          ${pfpImg(u,32)}
          <div><div style="font-weight:700;">${esc(u.displayName||u.username)}</div><div class="muted small">${esc(u.email)}</div></div>
        </div>
        <div class="admin-section-title">built-in tags</div>
        <div class="admin-tag-row">
          <label><input type="checkbox" id="tagDev" ${u.tags.dev?'checked':''}> <span class="tag-badge tag-dev">dev</span></label>
          <label><input type="checkbox" id="tagOwner" ${u.tags.owner?'checked':''}> <span class="tag-badge tag-owner">owner</span></label>
          <label><input type="checkbox" id="tagOwnerAccess" ${u.tags.ownerAccess?'checked':''}> owner access</label>
        </div>
        <button class="btn-ghost" id="saveTagsBtn" style="margin-top:6px;"><i class="fa-solid fa-floppy-disk"></i> save built-in tags</button>
        <div class="admin-section-title" style="margin-top:12px;">custom tags</div>
        <div class="admin-custom-tags-list">${customTagsCheckboxes}</div>
        <button class="btn-ghost" id="saveCustomTagsBtn" style="margin-top:6px;"><i class="fa-solid fa-floppy-disk"></i> save custom tags</button>
        <div style="display:flex;gap:8px;margin-top:12px;">
          <button class="${u.banned?'btn-ghost':'btn-danger'}" id="banBtn"><i class="fa-solid fa-${u.banned?'check':'ban'}"></i> ${u.banned?'unban':'ban'}</button>
        </div>
      </div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:8px;"><i class="fa-solid fa-code"></i> scripts (${scripts.length})</div>
      ${scripts.map(s=>`<div class="admin-script-row"><span>${esc(s.title)}</span><button class="btn-danger" style="font-size:11px;padding:3px 8px;" data-del="${s.id}"><i class="fa-solid fa-trash"></i></button></div>`).join('')}`;

    $('#adminBack').onclick=()=>{ sfx.click(); loadAdminUsers(); };
    $('#saveTagsBtn').onclick=async()=>{
      await api(`/admin/users/${id}/tags`,{method:'POST',body:{dev:$('#tagDev').checked,owner:$('#tagOwner').checked,ownerAccess:$('#tagOwnerAccess').checked}});
      toast('tags saved!');
    };
    $('#saveCustomTagsBtn').onclick=async()=>{
      const checked = [...body.querySelectorAll('.ctag-check')].filter(c=>c.checked).map(c=>c.dataset.tagid);
      const unchecked = [...body.querySelectorAll('.ctag-check')].filter(c=>!c.checked).map(c=>c.dataset.tagid);
      for (const tagId of checked) await api(`/admin/users/${id}/custom-tags`,{method:'POST',body:{tagId}}).catch(()=>{});
      for (const tagId of unchecked) await api(`/admin/users/${id}/custom-tags`,{method:'POST',body:{tagId,remove:true}}).catch(()=>{});
      toast('custom tags saved!');
    };
    $('#banBtn').onclick=async()=>{ await api(`/admin/users/${id}/${u.banned?'unban':'ban'}`,{method:'POST'}); toast(u.banned?'unbanned':'banned'); loadAdminUsers(); };
    body.querySelectorAll('[data-del]').forEach(btn=>{
      btn.onclick=async()=>{ if(!confirm('Delete script?')) return; await api(`/admin/scripts/${btn.dataset.del}`,{method:'DELETE'}); toast('deleted'); loadAdminUserDetail(id); };
    });
  } catch(e) { body.innerHTML='error: '+e.message; }
}

// ---- Admin: Create (custom tags + custom panels) ----
async function loadAdminCreate() {
  const body=$('#adminBody');
  body.innerHTML = '<p class="muted small" style="padding:8px;">loading...</p>';

  const [customTagsData, panelsData] = await Promise.all([
    api('/custom-tags').catch(() => ({ tags: [] })),
    api('/panels').catch(() => ({ panels: [] }))
  ]);
  state.customTags = customTagsData.tags || [];
  state.panels = panelsData.panels || [];

  body.innerHTML = `
    <div class="admin-create-section">
      <div class="admin-create-tabs">
        <button class="admin-create-tab active" data-createtab="tag"><i class="fa-solid fa-tag"></i> tag</button>
        <button class="admin-create-tab" data-createtab="panel"><i class="fa-solid fa-table-columns"></i> panel</button>
      </div>
      <div id="createTabContent"></div>
    </div>`;

  body.querySelectorAll('.admin-create-tab').forEach(tab => {
    tab.onclick = () => {
      sfx.click();
      body.querySelectorAll('.admin-create-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      if (tab.dataset.createtab === 'tag') renderTagCreator();
      else renderPanelCreator();
    };
  });

  renderTagCreator();

  function renderTagCreator() {
    const content = $('#createTabContent');
    content.innerHTML = `
      <div class="create-form">
        <div class="create-form-title">create custom tag</div>
        <p class="muted small">tags can be assigned to any user and shown next to their name.</p>
        <div class="tag-preview-bar">
          <span class="muted small">preview:</span>
          <span id="tagPreview" class="tag-badge tag-custom" style="color:#fff;background:#333;font-family:inherit;">new tag</span>
        </div>
        <div class="profile-edit-field"><label>label</label><input id="ctLabel" maxlength="30" placeholder="e.g. Moderator" /></div>
        <div class="form-row-2">
          <div class="profile-edit-field"><label>text color</label><div class="color-pick-row"><input type="color" id="ctColor" value="#ffffff" /><input id="ctColorHex" value="#ffffff" maxlength="7" class="hex-input" /></div></div>
          <div class="profile-edit-field"><label>background</label><div class="color-pick-row"><input type="color" id="ctBg" value="#333333" /><input id="ctBgHex" value="#333333" maxlength="7" class="hex-input" /></div></div>
        </div>
        <div class="profile-edit-field">
          <label>font</label>
          <select id="ctFont">
            <option value="inherit">Default (IBM Plex Mono)</option>
            <option value="Orbitron">Orbitron</option>
            <option value="Rajdhani">Rajdhani</option>
            <option value="Share Tech Mono">Share Tech Mono</option>
            <option value="Space Grotesk">Space Grotesk</option>
          </select>
        </div>
        <div class="profile-edit-field"><label>icon <span class="muted small">(Font Awesome class, optional)</span></label><input id="ctIcon" placeholder="fa-solid fa-star" maxlength="50" /></div>
        <button class="btn-primary" id="createTagBtn"><i class="fa-solid fa-plus"></i> create tag</button>
        <p class="form-error" id="ctError"></p>
      </div>
      <div class="existing-tags-section">
        <div class="admin-section-title">existing custom tags</div>
        <div id="existingTagsList"></div>
      </div>`;

    // Live preview
    function updatePreview() {
      const p = content.querySelector('#tagPreview');
      const label = content.querySelector('#ctLabel').value || 'new tag';
      const color = content.querySelector('#ctColor').value;
      const bg = content.querySelector('#ctBg').value;
      const font = content.querySelector('#ctFont').value;
      const icon = content.querySelector('#ctIcon').value;
      const fontMap = { 'IBM Plex Mono': "'IBM Plex Mono',monospace", 'Orbitron': "'Orbitron',sans-serif", 'Rajdhani': "'Rajdhani',sans-serif", 'Share Tech Mono': "'Share Tech Mono',monospace", 'Space Grotesk': "'Space Grotesk',sans-serif", 'inherit': 'inherit' };
      p.style.color = color; p.style.background = bg; p.style.fontFamily = fontMap[font] || 'inherit';
      p.innerHTML = (icon ? `<i class="${esc(icon)}" style="margin-right:3px;"></i>` : '') + esc(label);
    }

    // Color sync
    const colorPairs = [['ctColor','ctColorHex'],['ctBg','ctBgHex']];
    colorPairs.forEach(([pickId, hexId]) => {
      const pick = content.querySelector('#'+pickId);
      const hex = content.querySelector('#'+hexId);
      pick.oninput = () => { hex.value = pick.value; updatePreview(); };
      hex.oninput = () => { if (/^#[0-9a-fA-F]{6}$/.test(hex.value)) { pick.value = hex.value; updatePreview(); } };
    });
    ['ctLabel','ctFont','ctIcon'].forEach(id => { content.querySelector('#'+id).oninput = updatePreview; });

    content.querySelector('#createTagBtn').onclick = async () => {
      const label = content.querySelector('#ctLabel').value.trim();
      if (!label) { content.querySelector('#ctError').textContent = 'label required'; return; }
      try {
        await api('/custom-tags', { method:'POST', body: {
          label, color: content.querySelector('#ctColor').value,
          bg: content.querySelector('#ctBg').value, font: content.querySelector('#ctFont').value,
          icon: content.querySelector('#ctIcon').value.trim()
        }});
        toast('tag created!');
        const freshData = await api('/custom-tags');
        state.customTags = freshData.tags || [];
        renderExistingTags();
      } catch(e) { content.querySelector('#ctError').textContent = e.message; }
    };

    renderExistingTags();
    function renderExistingTags() {
      const el = content.querySelector('#existingTagsList');
      if (!state.customTags.length) { el.innerHTML = '<p class="muted small">no custom tags yet</p>'; return; }
      el.innerHTML = state.customTags.map(ct => `
        <div class="existing-tag-row">
          ${renderCustomTagBadge(ct)}
          <span class="muted small">${esc(ct.label)}</span>
          <button class="btn-danger btn-sm" data-del-tag="${esc(ct.id)}"><i class="fa-solid fa-trash"></i></button>
        </div>`).join('');
      el.querySelectorAll('[data-del-tag]').forEach(btn => {
        btn.onclick = async () => {
          if (!confirm('Delete this tag? It will be removed from all users.')) return;
          await api(`/custom-tags/${btn.dataset.delTag}`, { method:'DELETE' });
          toast('tag deleted');
          const freshData = await api('/custom-tags');
          state.customTags = freshData.tags || [];
          renderExistingTags();
        };
      });
    }
  }

  function renderPanelCreator() {
    const content = $('#createTabContent');
    content.innerHTML = `
      <div class="create-form">
        <div class="create-form-title">create sidebar panel</div>
        <p class="muted small">panels appear in the left sidebar on the home page.</p>
        <div class="profile-edit-field"><label>panel title</label><input id="panelTitle" maxlength="50" placeholder="e.g. Quick Links" /></div>
        <div class="profile-edit-field">
          <label>panel type</label>
          <select id="panelType">
            <option value="announcements">📣 announcements</option>
            <option value="links">🔗 quick links</option>
            <option value="countdown">⏳ countdown</option>
            <option value="stats">📊 site stats</option>
            <option value="custom">✏️ custom text</option>
          </select>
        </div>
        <div id="panelTypeConfig"></div>
        <button class="btn-primary" id="createPanelBtn"><i class="fa-solid fa-plus"></i> create panel</button>
        <p class="form-error" id="panelError"></p>
      </div>
      <div class="existing-tags-section">
        <div class="admin-section-title">existing panels</div>
        <div id="existingPanelsList"></div>
      </div>`;

    content.querySelector('#panelType').onchange = renderPanelConfig;
    renderPanelConfig();
    renderExistingPanels();

    function renderPanelConfig() {
      const type = content.querySelector('#panelType').value;
      const cfg = content.querySelector('#panelTypeConfig');
      if (type === 'announcements') {
        cfg.innerHTML = `
          <div class="panel-config-block">
            <div class="muted small" style="margin-bottom:6px;">announcements (add up to 5)</div>
            <div id="announcementsConfig"></div>
            <button class="btn-ghost btn-sm" id="addAnnounceBtn"><i class="fa-solid fa-plus"></i> add announcement</button>
          </div>`;
        cfg.querySelector('#addAnnounceBtn').onclick = () => addAnnouncementRow(cfg.querySelector('#announcementsConfig'));
        addAnnouncementRow(cfg.querySelector('#announcementsConfig'));
      } else if (type === 'links') {
        cfg.innerHTML = `
          <div class="panel-config-block">
            <div class="muted small" style="margin-bottom:6px;">links</div>
            <div id="linksConfig"></div>
            <button class="btn-ghost btn-sm" id="addLinkBtn"><i class="fa-solid fa-plus"></i> add link</button>
          </div>`;
        cfg.querySelector('#addLinkBtn').onclick = () => addLinkRow(cfg.querySelector('#linksConfig'));
        addLinkRow(cfg.querySelector('#linksConfig'));
      } else if (type === 'countdown') {
        cfg.innerHTML = `
          <div class="panel-config-block">
            <div class="profile-edit-field"><label>event label</label><input id="countdownLabel" placeholder="e.g. Next update..." /></div>
            <div class="profile-edit-field"><label>target date/time</label><input type="datetime-local" id="countdownTarget" /></div>
          </div>`;
      } else if (type === 'custom') {
        cfg.innerHTML = `
          <div class="panel-config-block">
            <div class="profile-edit-field"><label>icon <span class="muted small">(Font Awesome class, optional)</span></label><input id="customIcon" placeholder="fa-solid fa-star" /></div>
            <div class="profile-edit-field"><label>content</label><textarea id="customContent" rows="4" maxlength="400" placeholder="freeform text content..."></textarea></div>
          </div>`;
      } else {
        cfg.innerHTML = '';
      }
    }

    function addAnnouncementRow(container) {
      if (container.children.length >= 5) { toast('max 5 announcements', true); return; }
      const div = document.createElement('div'); div.className = 'news-editor-item';
      div.innerHTML = `<input placeholder="announcement text..." class="ann-text" /><div style="display:flex;gap:4px;align-items:center;"><input placeholder="date" style="width:110px;" class="ann-date" /><label style="display:flex;align-items:center;gap:4px;font-size:11px;"><input type="checkbox" class="ann-pin"> pin</label><button class="btn-danger btn-sm ann-del"><i class="fa-solid fa-xmark"></i></button></div>`;
      div.querySelector('.ann-del').onclick = () => div.remove();
      container.appendChild(div);
    }
    function addLinkRow(container) {
      const div = document.createElement('div'); div.className = 'news-editor-item';
      div.innerHTML = `<input placeholder="label" class="link-label" style="width:120px;" /><input placeholder="https://..." class="link-url" /><input placeholder="fa-solid fa-link" class="link-icon" style="width:130px;" /><button class="btn-danger btn-sm link-del"><i class="fa-solid fa-xmark"></i></button>`;
      div.querySelector('.link-del').onclick = () => div.remove();
      container.appendChild(div);
    }

    content.querySelector('#createPanelBtn').onclick = async () => {
      const title = content.querySelector('#panelTitle').value.trim();
      const type = content.querySelector('#panelType').value;
      if (!title) { content.querySelector('#panelError').textContent = 'title required'; return; }
      let panelConfig = {};
      if (type === 'announcements') {
        const items = [...content.querySelectorAll('#announcementsConfig .news-editor-item')].map(row => ({
          text: row.querySelector('.ann-text').value.trim(),
          date: row.querySelector('.ann-date').value.trim(),
          pinned: row.querySelector('.ann-pin').checked,
        })).filter(i => i.text);
        panelConfig = { items };
      } else if (type === 'links') {
        const links = [...content.querySelectorAll('#linksConfig .news-editor-item')].map(row => ({
          label: row.querySelector('.link-label').value.trim(),
          url: row.querySelector('.link-url').value.trim(),
          icon: row.querySelector('.link-icon').value.trim(),
        })).filter(l => l.label && l.url);
        panelConfig = { links };
      } else if (type === 'countdown') {
        panelConfig = { label: content.querySelector('#countdownLabel')?.value||'', target: content.querySelector('#countdownTarget')?.value||'' };
      } else if (type === 'custom') {
        panelConfig = { icon: content.querySelector('#customIcon')?.value||'', content: content.querySelector('#customContent')?.value||'' };
      }
      try {
        await api('/panels', { method:'POST', body: { title, type, config: panelConfig } });
        toast('panel created!');
        const freshData = await api('/panels');
        state.panels = freshData.panels || [];
        renderExistingPanels();
        loadSidebar(); // live update
      } catch(e) { content.querySelector('#panelError').textContent = e.message; }
    };

    function renderExistingPanels() {
      const el = content.querySelector('#existingPanelsList');
      if (!el) return;
      if (!state.panels.length) { el.innerHTML = '<p class="muted small">no panels yet</p>'; return; }
      el.innerHTML = state.panels.map(p => `
        <div class="existing-panel-row">
          <div>
            <span class="existing-panel-title">${esc(p.title)}</span>
            <span class="muted small">${esc(p.type)}</span>
          </div>
          <div style="display:flex;gap:6px;align-items:center;">
            <label style="display:flex;align-items:center;gap:4px;font-size:11px;">
              <input type="checkbox" class="panel-enabled-toggle" data-id="${esc(p.id)}" ${p.enabled?'checked':''}> on
            </label>
            <button class="btn-danger btn-sm" data-del-panel="${esc(p.id)}"><i class="fa-solid fa-trash"></i></button>
          </div>
        </div>`).join('');
      el.querySelectorAll('.panel-enabled-toggle').forEach(cb => {
        cb.onchange = async () => {
          await api(`/panels/${cb.dataset.id}`, { method:'PUT', body:{ enabled: cb.checked } });
          toast(cb.checked ? 'panel enabled' : 'panel hidden');
          const freshData = await api('/panels');
          state.panels = freshData.panels || [];
          loadSidebar();
        };
      });
      el.querySelectorAll('[data-del-panel]').forEach(btn => {
        btn.onclick = async () => {
          if (!confirm('Delete this panel?')) return;
          await api(`/panels/${btn.dataset.delPanel}`, { method:'DELETE' });
          toast('panel deleted');
          const freshData = await api('/panels');
          state.panels = freshData.panels || [];
          renderExistingPanels();
          loadSidebar();
        };
      });
    }
  }
}

async function loadAdminSettings() {
  const body=$('#adminBody'); body.innerHTML='loading...';
  try {
    const data=await api('/settings'); const s=data.settings; const news=s.news||[];
    body.innerHTML=`
      <div class="admin-settings-form">
        <label style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:0.4px;"><i class="fa-solid fa-tag"></i> version</label>
        <input id="settingsVersion" value="${esc(s.version||'')}" />
        <label style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:0.4px;"><i class="fa-solid fa-bolt"></i> update text</label>
        <textarea id="settingsUpdate" rows="3">${esc(s.latestUpdate||'')}</textarea>
        <label style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:0.4px;"><i class="fa-solid fa-newspaper"></i> news feed (max 5)</label>
        <div class="news-editor" id="newsEditor">
          ${news.map((n,i)=>`<div class="news-editor-item"><input placeholder="news text..." value="${esc(n.text||'')}" data-news-text="${i}" /><input placeholder="date" style="width:110px;" value="${esc(n.date||'')}" data-news-date="${i}" /><button class="btn-danger" style="padding:4px 8px;" data-news-del="${i}"><i class="fa-solid fa-xmark"></i></button></div>`).join('')}
        </div>
        <button class="btn-ghost" id="addNewsItemBtn"><i class="fa-solid fa-plus"></i> add news item</button>
        <button class="btn-primary" id="saveSettingsBtn"><i class="fa-solid fa-floppy-disk"></i> save settings</button>
        <p class="form-error" id="settingsError"></p>
      </div>`;
    $('#addNewsItemBtn').onclick=()=>{
      const editor=$('#newsEditor'); const i=editor.children.length;
      if(i>=5){toast('max 5 news items',true);return;}
      const div=document.createElement('div'); div.className='news-editor-item';
      div.innerHTML=`<input placeholder="news text..." data-news-text="${i}" /><input placeholder="date" style="width:110px;" data-news-date="${i}" /><button class="btn-danger" style="padding:4px 8px;" data-news-del="${i}"><i class="fa-solid fa-xmark"></i></button>`;
      editor.appendChild(div); setupNewsDelBtns();
    };
    setupNewsDelBtns();
    $('#saveSettingsBtn').onclick=async()=>{
      const newsItems=[];
      $$('[data-news-text]').forEach(inp=>{
        const idx=inp.dataset.newsText;
        const dateInp=document.querySelector(`[data-news-date="${idx}"]`);
        if(inp.value.trim()) newsItems.push({text:inp.value.trim(),date:dateInp?.value.trim()||''});
      });
      try {
        await api('/admin/settings',{method:'PUT',body:{version:$('#settingsVersion').value,latestUpdate:$('#settingsUpdate').value,news:newsItems}});
        toast('settings saved!');
        $('#versionBadge').textContent='v'+$('#settingsVersion').value;
        loadSidebar();
      } catch(err){ $('#settingsError').innerHTML=`<i class="fa-solid fa-triangle-exclamation"></i> ${esc(err.message)}`; sfx.error(); }
    };
  } catch(e){ body.innerHTML='error: '+e.message; }
}

function setupNewsDelBtns() {
  $$('[data-news-del]').forEach(btn=>{ btn.onclick=()=>{ sfx.click(); btn.closest('.news-editor-item').remove(); }; });
}

// ---- SSE live updates ----
function connectSSE() {
  try {
    const es = new EventSource('/api/sse');
    es.addEventListener('script:new', e => {
      try {
        const d = JSON.parse(e.data);
        toast(`new script: "${d.title}" by ${d.author}`);
        loadScripts();
      } catch(err) {}
    });
    es.addEventListener('panel:update', () => { loadSidebar(); });
    es.addEventListener('customtag:new', e => {
      try {
        const tag = JSON.parse(e.data);
        if (!state.customTags.find(t => t.id === tag.id)) state.customTags.push(tag);
      } catch(err) {}
    });
    es.addEventListener('customtag:delete', e => {
      try {
        const { id } = JSON.parse(e.data);
        state.customTags = state.customTags.filter(t => t.id !== id);
      } catch(err) {}
    });
    es.addEventListener('settings:update', () => { loadSidebar(); });
    es.onerror = () => setTimeout(connectSSE, 5000);
  } catch(e) {}
}

// ---- Init ----
async function init() {
  const stored = localStorage.getItem('user');
  if (stored && state.token) { try { state.user=JSON.parse(stored); } catch(e){} }
  renderAuthArea();
  setupGoogle();
  setupRipples();
  setupFileUpload();

  if (state.token) {
    try {
      const data=await api('/me'); state.user=data.user;
      localStorage.setItem('user',JSON.stringify(data.user)); renderAuthArea();
    } catch(e) {
      state.token=null; state.user=null;
      localStorage.removeItem('token'); localStorage.removeItem('user'); renderAuthArea();
    }
  }

  try {
    const [settingsData, customTagsData] = await Promise.all([api('/settings'), api('/custom-tags').catch(()=>({tags:[]}))]);
    state.customTags = customTagsData.tags || [];
    if (settingsData.settings?.version) $('#versionBadge').textContent='v'+settingsData.settings.version;
  } catch(e){}

  connectSSE();
  loadScripts();
}

init();

// ════════════════════════════════════════
// VISUAL CUSTOMIZER
// ════════════════════════════════════════

const THEME_PRESETS = {
  'dark-blue': {
    name: '🌌 Dark Blue',
    vars: {
      '--bg': '#0a0d12', '--surface': '#111620', '--surface2': '#161c28',
      '--surface3': '#1c2438', '--border': '#222d40', '--border2': '#2a3550',
      '--accent': '#3b82f6', '--accent2': '#a78bfa', '--good': '#34d399',
      '--text': '#e2e8f4', '--text2': '#94a3b8',
    }
  },
  'midnight': {
    name: '🖤 Midnight',
    vars: {
      '--bg': '#050507', '--surface': '#0d0d14', '--surface2': '#121219',
      '--surface3': '#18181f', '--border': '#1f1f2e', '--border2': '#27273a',
      '--accent': '#818cf8', '--accent2': '#f472b6', '--good': '#34d399',
      '--text': '#e0e0f0', '--text2': '#7070a0',
    }
  },
  'forest': {
    name: '🌿 Forest',
    vars: {
      '--bg': '#060d08', '--surface': '#0d1810', '--surface2': '#111f14',
      '--surface3': '#162718', '--border': '#1e3422', '--border2': '#28442e',
      '--accent': '#34d399', '--accent2': '#86efac', '--good': '#4ade80',
      '--text': '#d1fae5', '--text2': '#6b9e7a',
    }
  },
  'sunset': {
    name: '🌅 Sunset',
    vars: {
      '--bg': '#0d0806', '--surface': '#1a100c', '--surface2': '#211410',
      '--surface3': '#2a1914', '--border': '#3d2418', '--border2': '#4d2e20',
      '--accent': '#fb923c', '--accent2': '#f472b6', '--good': '#34d399',
      '--text': '#fde8d8', '--text2': '#a07060',
    }
  },
  'ice': {
    name: '🧊 Ice',
    vars: {
      '--bg': '#08090f', '--surface': '#0f111a', '--surface2': '#141722',
      '--surface3': '#1a1e2e', '--border': '#242840', '--border2': '#2e3450',
      '--accent': '#67e8f9', '--accent2': '#818cf8', '--good': '#34d399',
      '--text': '#e0f2fe', '--text2': '#7090b0',
    }
  },
  'light': {
    name: '☀️ Light',
    vars: {
      '--bg': '#f8fafc', '--surface': '#ffffff', '--surface2': '#f1f5f9',
      '--surface3': '#e2e8f0', '--border': '#cbd5e1', '--border2': '#94a3b8',
      '--accent': '#2563eb', '--accent2': '#7c3aed', '--good': '#059669',
      '--text': '#0f172a', '--text2': '#475569',
      '--topbar-bg': 'rgba(248,250,252,0.92)',
    }
  }
};

let customizerState = {
  vars: {},
  font: 'Space Grotesk',
  noiseEnabled: true,
  glowEnabled: true,
  cardHoverEnabled: true,
  scanlines: false,
  borderRadius: 10,
  preset: 'dark-blue',
};

function loadCustomizerState() {
  try {
    const saved = localStorage.getItem('zscript-theme');
    if (saved) customizerState = { ...customizerState, ...JSON.parse(saved) };
  } catch(e) {}
  applyTheme();
}

function saveCustomizerState() {
  localStorage.setItem('zscript-theme', JSON.stringify(customizerState));
}

function applyTheme() {
  let style = document.getElementById('theme-override');
  if (!style) { style = document.createElement('style'); style.id = 'theme-override'; document.head.appendChild(style); }

  const vars = { ...customizerState.vars };
  const fontMap = {
    'Space Grotesk': "'Space Grotesk', system-ui, sans-serif",
    'IBM Plex Mono': "'IBM Plex Mono', monospace",
    'Rajdhani': "'Rajdhani', sans-serif",
    'Orbitron': "'Orbitron', sans-serif",
    'Share Tech Mono': "'Share Tech Mono', monospace",
  };

  const cssParts = [`:root {`];
  for (const [k, v] of Object.entries(vars)) {
    cssParts.push(`  ${k}: ${v};`);
  }
  cssParts.push(`  --font-ui: ${fontMap[customizerState.font] || fontMap['Space Grotesk']};`);
  cssParts.push(`  --radius: ${customizerState.borderRadius}px;`);
  cssParts.push(`  --radius-sm: ${Math.max(2, customizerState.borderRadius - 4)}px;`);
  cssParts.push(`  --radius-lg: ${customizerState.borderRadius + 4}px;`);
  cssParts.push(`  --radius-xl: ${customizerState.borderRadius + 10}px;`);
  cssParts.push(`  --card-hover-y: ${customizerState.cardHoverEnabled ? '-3px' : '0px'};`);
  cssParts.push(`}`);

  // Noise
  if (!customizerState.noiseEnabled) {
    cssParts.push(`body::before { display: none; }`);
  }
  // Glow
  if (!customizerState.glowEnabled) {
    cssParts.push(`.page-glow { display: none; }`);
  }
  // Scanlines
  if (customizerState.scanlines) {
    cssParts.push(`body::after {
      content:"";position:fixed;inset:0;pointer-events:none;z-index:9998;
      background:repeating-linear-gradient(to bottom,rgba(0,0,0,0.09) 0px,rgba(0,0,0,0.09) 1px,transparent 1px,transparent 3px);
    }`);
  }

  style.textContent = cssParts.join('\n');
}

function openCustomizer() {
  sfx.open();
  renderCustomizer();
  openModal('customizerModalBackdrop');
}

function renderCustomizer() {
  const el = $('#customizerContent');
  const s = customizerState;

  // Determine active preset
  const activePreset = s.preset || '';

  const colorFields = [
    { key: '--bg',       label: 'Background' },
    { key: '--surface',  label: 'Surface' },
    { key: '--surface2', label: 'Surface 2' },
    { key: '--border',   label: 'Border' },
    { key: '--accent',   label: 'Accent (primary)' },
    { key: '--accent2',  label: 'Accent (secondary)' },
    { key: '--good',     label: 'Success green' },
    { key: '--text',     label: 'Text' },
    { key: '--text2',    label: 'Muted text' },
    { key: '--danger',   label: 'Danger red' },
  ];

  // Get current effective value for a var
  function getVar(key) {
    if (s.vars && s.vars[key]) return s.vars[key];
    // From active preset
    if (activePreset && THEME_PRESETS[activePreset]) return THEME_PRESETS[activePreset].vars[key] || '';
    return getComputedStyle(document.documentElement).getPropertyValue(key).trim();
  }

  el.innerHTML = `
    <div class="customizer-section-title">theme presets</div>
    <div class="theme-presets">
      ${Object.entries(THEME_PRESETS).map(([k, p]) =>
        `<button class="theme-preset-btn ${activePreset === k ? 'active' : ''}" data-preset="${k}">${p.name}</button>`
      ).join('')}
    </div>

    <div class="customizer-section-title">colours</div>
    <div class="customizer-grid">
      ${colorFields.map(f => {
        const val = getVar(f.key);
        const hexVal = val.startsWith('#') ? val : '#111111';
        return `<div class="customizer-item">
          <div class="customizer-label">${f.label}</div>
          <div class="customizer-color-row">
            <input type="color" data-var="${f.key}" value="${hexVal}" />
            <input type="text" data-var-hex="${f.key}" value="${val}" placeholder="${f.key}" />
          </div>
        </div>`;
      }).join('')}
    </div>

    <div class="customizer-section-title">typography & shape</div>
    <div class="customizer-grid">
      <div class="customizer-item">
        <div class="customizer-label">UI font</div>
        <select class="customizer-font-select" id="customizerFont">
          ${['Space Grotesk','IBM Plex Mono','Rajdhani','Share Tech Mono','Orbitron'].map(f =>
            `<option ${s.font===f?'selected':''} value="${f}">${f}</option>`
          ).join('')}
        </select>
      </div>
      <div class="customizer-item">
        <div class="customizer-label">Corner radius: <span id="radiusVal">${s.borderRadius}px</span></div>
        <input type="range" id="customizerRadius" min="0" max="24" value="${s.borderRadius}" style="margin-top:8px;accent-color:var(--accent);width:100%;" />
      </div>
    </div>

    <div class="customizer-section-title">effects</div>
    <div class="customizer-toggles">
      ${[
        { id:'toggleNoise',    label:'Noise texture overlay', checked: s.noiseEnabled },
        { id:'toggleGlow',     label:'Ambient page glow',     checked: s.glowEnabled },
        { id:'toggleHover',    label:'Card hover lift effect', checked: s.cardHoverEnabled },
        { id:'toggleScanlines',label:'Scanlines overlay',     checked: s.scanlines },
      ].map(t => `
        <div class="customizer-toggle-row">
          <span>${t.label}</span>
          <label class="switch"><input type="checkbox" id="${t.id}" ${t.checked?'checked':''}><span class="switch-slider"></span></label>
        </div>`).join('')}
    </div>

    <div class="customizer-section-title">preview</div>
    <div class="customizer-preview">
      <div class="customizer-preview-card">
        <div class="customizer-preview-title">Example Script Card</div>
        <div class="customizer-preview-meta">by Z3N0 · <span class="tag-badge tag-owner">owner</span> · 5m ago</div>
        <div style="margin-top:8px;display:flex;gap:5px;">
          <span class="tag-pill">vr</span>
          <span class="tag-pill">unity</span>
          <span class="lang">cs</span>
        </div>
      </div>
    </div>

    <div class="customizer-actions">
      <button class="btn-secondary" id="customizerReset"><i class="fa-solid fa-rotate-left"></i> reset</button>
      <button class="btn-ghost" id="customizerExport"><i class="fa-solid fa-download"></i> export</button>
      <button class="btn-primary" id="customizerSave"><i class="fa-solid fa-floppy-disk"></i> apply & save</button>
    </div>`;

  // Preset buttons
  el.querySelectorAll('.theme-preset-btn').forEach(btn => {
    btn.onclick = () => {
      sfx.click();
      const preset = THEME_PRESETS[btn.dataset.preset];
      if (!preset) return;
      customizerState.preset = btn.dataset.preset;
      customizerState.vars = { ...preset.vars };
      applyTheme();
      renderCustomizer(); // re-render with new values
    };
  });

  // Color pickers
  el.querySelectorAll('[data-var]').forEach(input => {
    input.oninput = () => {
      const key = input.dataset.var;
      customizerState.vars[key] = input.value;
      customizerState.preset = 'custom';
      // sync hex field
      const hexField = el.querySelector(`[data-var-hex="${key}"]`);
      if (hexField) hexField.value = input.value;
      applyTheme();
    };
  });
  el.querySelectorAll('[data-var-hex]').forEach(input => {
    input.oninput = () => {
      const key = input.dataset.varHex;
      customizerState.vars[key] = input.value;
      customizerState.preset = 'custom';
      if (/^#[0-9a-fA-F]{6}$/.test(input.value)) {
        const picker = el.querySelector(`[data-var="${key}"]`);
        if (picker) picker.value = input.value;
      }
      applyTheme();
    };
  });

  // Font
  el.querySelector('#customizerFont').onchange = e => {
    customizerState.font = e.target.value;
    applyTheme();
  };

  // Radius
  el.querySelector('#customizerRadius').oninput = e => {
    customizerState.borderRadius = parseInt(e.target.value);
    el.querySelector('#radiusVal').textContent = customizerState.borderRadius + 'px';
    applyTheme();
  };

  // Toggles
  const toggleMap = {
    toggleNoise: 'noiseEnabled', toggleGlow: 'glowEnabled',
    toggleHover: 'cardHoverEnabled', toggleScanlines: 'scanlines',
  };
  Object.entries(toggleMap).forEach(([id, prop]) => {
    el.querySelector('#'+id).onchange = e => {
      customizerState[prop] = e.target.checked;
      applyTheme();
    };
  });

  // Save
  el.querySelector('#customizerSave').onclick = () => {
    saveCustomizerState();
    toast('theme saved!');
    sfx.success();
    closeModal('customizerModalBackdrop');
  };

  // Reset
  el.querySelector('#customizerReset').onclick = () => {
    if (!confirm('Reset to default theme?')) return;
    customizerState = {
      vars: {}, font: 'Space Grotesk', noiseEnabled: true,
      glowEnabled: true, cardHoverEnabled: true, scanlines: false,
      borderRadius: 10, preset: 'dark-blue',
    };
    localStorage.removeItem('zscript-theme');
    applyTheme();
    renderCustomizer();
    toast('theme reset');
  };

  // Export
  el.querySelector('#customizerExport').onclick = () => {
    const json = JSON.stringify(customizerState, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'zscripts-theme.json';
    a.click();
    toast('theme exported!');
  };
}

// Hook up the customizer button
document.addEventListener('DOMContentLoaded', () => {});
// (button setup happens after DOM is ready in init)

// ════════════════════════════════════════
// OWNER PANEL EXTRA FEATURES
// patch in broadcast endpoint + more admin tabs
// ════════════════════════════════════════

// Patch admin tabs to add Analytics and Scripts
const _origAdminTabClick = null;
function patchAdminTabs() {
  const tabBar = $('.admin-tabs');
  if (!tabBar || tabBar.dataset.patched) return;
  tabBar.dataset.patched = '1';

  // Add analytics + scripts tabs
  const newTabs = [
    { key: 'analytics', icon: 'fa-chart-line', label: 'analytics' },
    { key: 'scripts',   icon: 'fa-code',       label: 'scripts'   },
    { key: 'broadcast', icon: 'fa-bullhorn',    label: 'broadcast' },
  ];
  newTabs.forEach(t => {
    const btn = document.createElement('button');
    btn.className = 'admin-tab';
    btn.dataset.admintab = t.key;
    btn.innerHTML = `<i class="fa-solid ${t.icon}"></i> ${t.label}`;
    tabBar.appendChild(btn);
    btn.onclick = () => {
      sfx.click();
      $$('.admin-tab').forEach(x => x.classList.remove('active'));
      btn.classList.add('active');
      if (t.key === 'analytics') loadAdminAnalytics();
      else if (t.key === 'scripts') loadAdminScripts();
      else if (t.key === 'broadcast') loadAdminBroadcast();
    };
  });
}

async function loadAdminAnalytics() {
  const body = $('#adminBody');
  body.innerHTML = '<p class="muted small">loading...</p>';
  try {
    const [scripts, users] = await Promise.all([api('/scripts'), api('/users')]);
    const allScripts = scripts.scripts || [];
    const allUsers = users.users || [];
    const totalInstalls = allScripts.reduce((a,s)=>a+(s.installs||0),0);
    const topLang = (() => {
      const counts = {};
      allScripts.forEach(s => { const l = s.language||'unknown'; counts[l]=(counts[l]||0)+1; });
      return Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,5);
    })();
    const last24h = allScripts.filter(s => Date.now()-new Date(s.createdAt) < 86400000).length;

    body.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px;">
        ${[
          { label:'Total Scripts',    val: allScripts.length,  icon:'fa-code',     color:'var(--accent)' },
          { label:'Total Users',      val: allUsers.length,    icon:'fa-users',    color:'var(--accent2)' },
          { label:'Total Installs',   val: totalInstalls,      icon:'fa-download', color:'var(--good)' },
          { label:'Scripts (24h)',    val: last24h,            icon:'fa-bolt',     color:'var(--warn)' },
        ].map(s=>`
          <div style="background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius);padding:12px;">
            <div style="font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:var(--text2);margin-bottom:4px;">
              <i class="fa-solid ${s.icon}" style="color:${s.color};margin-right:4px;"></i>${s.label}
            </div>
            <div style="font-size:24px;font-weight:700;font-family:var(--font-mono);color:${s.color};">${s.val}</div>
          </div>`).join('')}
      </div>
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--text2);margin-bottom:8px;">top languages</div>
      ${topLang.map(([lang,count])=>`
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
          <span class="lang">${esc(lang)}</span>
          <div style="flex:1;background:var(--surface2);border-radius:4px;height:6px;overflow:hidden;">
            <div style="width:${Math.round(count/allScripts.length*100)}%;height:100%;background:var(--accent);border-radius:4px;"></div>
          </div>
          <span style="font-size:11px;color:var(--text2);min-width:20px;text-align:right;">${count}</span>
        </div>`).join('')}
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--text2);margin:14px 0 8px;">top scripts by installs</div>
      ${allScripts.sort((a,b)=>(b.installs||0)-(a.installs||0)).slice(0,8).map((s,i)=>`
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:5px;font-size:12px;">
          <span style="color:var(--text2);min-width:18px;">#${i+1}</span>
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(s.title)}</span>
          <span style="color:var(--good);font-family:var(--font-mono);">${s.installs||0}</span>
        </div>`).join('')}`;
  } catch(e) { body.innerHTML = 'error: ' + e.message; }
}

async function loadAdminScripts(search='') {
  const body = $('#adminBody');
  body.innerHTML = `<div class="admin-search-row"><input id="adminScriptSearch" placeholder="search scripts..." value="${esc(search)}" /><button id="adminScriptSearchBtn">search</button></div><div id="adminScriptsList">loading...</div>`;
  $('#adminScriptSearchBtn').onclick = () => loadAdminScripts($('#adminScriptSearch').value.trim());
  $('#adminScriptSearch').onkeydown = e => { if(e.key==='Enter') loadAdminScripts($('#adminScriptSearch').value.trim()); };
  try {
    const data = await api('/scripts' + (search?`?search=${encodeURIComponent(search)}`:'')); 
    const list = $('#adminScriptsList');
    list.innerHTML = (data.scripts||[]).map(s=>`
      <div class="admin-script-row" style="flex-direction:column;align-items:flex-start;gap:4px;padding:10px;">
        <div style="display:flex;align-items:center;justify-content:space-between;width:100%;gap:8px;">
          <span style="font-weight:600;font-size:13px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(s.title)}</span>
          <div style="display:flex;gap:5px;flex-shrink:0;">
            <span class="lang">${esc(s.language||'?')}</span>
            <span style="font-size:10px;color:var(--good);">${s.installs||0} installs</span>
            <button class="btn-danger btn-sm" data-del="${s.id}"><i class="fa-solid fa-trash"></i></button>
          </div>
        </div>
        <div style="font-size:11px;color:var(--text2);">by ${esc(s.author?.username||'?')} · ${timeAgo(s.createdAt)}</div>
      </div>`).join('') || '<p class="muted small">no scripts</p>';
    list.querySelectorAll('[data-del]').forEach(btn=>{
      btn.onclick=async()=>{
        if(!confirm('Delete script?')) return;
        await api(`/admin/scripts/${btn.dataset.del}`,{method:'DELETE'});
        toast('deleted'); loadAdminScripts(search);
      };
    });
  } catch(e) { $('#adminScriptsList').textContent='error: '+e.message; }
}

function loadAdminBroadcast() {
  const body = $('#adminBody');
  body.innerHTML = `
    <div style="margin-bottom:12px;">
      <div class="admin-section-title">send site announcement</div>
      <p class="muted small" style="margin-bottom:10px;">broadcasts a toast notification to all connected users in real time.</p>
      <div class="profile-edit-field">
        <label>message</label>
        <textarea id="broadcastMsg" rows="3" placeholder="Type your announcement..." style="background:var(--bg);border:1px solid var(--border);color:var(--text);padding:8px;border-radius:var(--radius-sm);outline:none;font-size:13px;font-family:var(--font-mono);resize:vertical;"></textarea>
      </div>
      <div style="display:flex;gap:8px;margin-top:8px;">
        <button class="btn-primary" id="sendBroadcastBtn"><i class="fa-solid fa-bullhorn"></i> broadcast</button>
        <button class="btn-ghost" id="testToastBtn"><i class="fa-solid fa-eye"></i> preview locally</button>
      </div>
      <p class="form-error" id="broadcastError"></p>
    </div>
    <div style="margin-top:16px;">
      <div class="admin-section-title">quick actions</div>
      <div style="display:flex;flex-direction:column;gap:6px;margin-top:8px;">
        <button class="btn-secondary" id="qaRefreshSidebar"><i class="fa-solid fa-rotate"></i> force sidebar refresh for all</button>
        <button class="btn-secondary" id="qaToastAll"><i class="fa-solid fa-bell"></i> ping all: "site updated!"</button>
      </div>
    </div>`;

  $('#testToastBtn').onclick = () => {
    const msg = $('#broadcastMsg').value.trim();
    if (!msg) { toast('type a message first', true); return; }
    toast(msg);
  };
  $('#sendBroadcastBtn').onclick = async () => {
    const msg = $('#broadcastMsg').value.trim();
    if (!msg) { $('#broadcastError').textContent = 'message required'; return; }
    try {
      // We piggyback on the news API to broadcast — save as news then trigger reload
      const data = await api('/settings');
      const news = [{ text: msg, date: new Date().toLocaleDateString() }, ...(data.settings?.news||[])].slice(0,5);
      await api('/admin/settings', { method:'PUT', body:{ news } });
      toast('broadcast sent!');
      $('#broadcastMsg').value = '';
    } catch(e) { $('#broadcastError').textContent = e.message; }
  };
  $('#qaRefreshSidebar').onclick = async () => {
    // touch settings to trigger SSE
    const data = await api('/settings');
    await api('/admin/settings', { method:'PUT', body:{ version: data.settings?.version||'1.0.0' } });
    toast('sidebar refresh triggered');
  };
  $('#qaToastAll').onclick = async () => {
    const data = await api('/settings');
    const news = [{ text:'🔔 Site updated! Refresh for latest changes.', date: new Date().toLocaleDateString() }, ...(data.settings?.news||[])].slice(0,5);
    await api('/admin/settings', { method:'PUT', body:{ news } });
    toast('pinged all users!');
  };
}

window._adminPatched = false;

// Wire customizer button (after DOM ready)
setTimeout(() => {
  const custBtn = $('#customizerBtn');
  if (custBtn) custBtn.onclick = openCustomizer;
  loadCustomizerState();
}, 100);
