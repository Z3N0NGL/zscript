// app.js - ZScripts frontend

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

const state = {
  user: null,
  token: localStorage.getItem('token') || null,
  config: { googleEnabled: false, googleClientId: '' },
};

// ---- Sound engine ----
const AudioCtx = window.AudioContext || window.webkitAudioContext;
let actx = null;
function getACtx() {
  if (!actx) actx = new AudioCtx();
  return actx;
}
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

function tagBadgesHtml(tags, activeTag) {
  if (!tags) return '';
  if (activeTag === 'owner' && tags.owner) return `<span class="tag-badge tag-owner">owner</span>`;
  if (activeTag === 'dev' && tags.dev) return `<span class="tag-badge tag-dev">dev</span>`;
  if (!activeTag) {
    if (tags.owner) return `<span class="tag-badge tag-owner">owner</span>`;
    if (tags.dev) return `<span class="tag-badge tag-dev">dev</span>`;
  }
  return '';
}

function hasAnyTag(user) {
  return user?.tags && (user.tags.owner || user.tags.dev);
}

function esc(str) {
  return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
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
  } else {
    $('.account-pill')?.classList.remove('open');
  }
  // btn-ghost / btn-link general sound
  if (e.target.closest('.btn-ghost, .btn-link') && !e.target.closest('[data-nav],[data-close]')) sfx.click();
});

// hover sounds on cards
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

function openModal(id) {
  $(`#${id}`)?.classList.remove('hidden');
  sfx.open();
  setTimeout(setupRipples, 50);
}
function closeModal(id) { $(`#${id}`)?.classList.add('hidden'); }

// ---- Auth UI ----
function renderAuthArea() {
  const area = $('#authArea');
  if (!state.user) {
    area.innerHTML = `<button class="btn-ghost ripple" id="loginBtn"><i class="fa-solid fa-right-to-bracket"></i> log in</button>`;
    $('#loginBtn').addEventListener('click', () => openModal('authModalBackdrop'));
  } else {
    const u = state.user;
    area.innerHTML = `
      <div class="account-pill" id="accountPill">
        ${pfpImg(u, 24)}
        <span>${esc(u.displayName || u.username)}</span>
        ${u.activeTag && u.tags[u.activeTag] ? `<span class="active-tag-display" style="color:${u.activeTag==='owner'?'var(--accent)':'var(--accent2)'};">${u.activeTag}</span>` : ''}
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
  if (!u || !hasAnyTag(u)) return;
  sfx.wardrobe();
  const opts = $('#wardrobeOptions');
  opts.innerHTML = '';
  const available = [];
  if (u.tags.owner) available.push({ key: 'owner', label: 'Owner', cls: 'tag-owner' });
  if (u.tags.dev) available.push({ key: 'dev', label: 'Dev', cls: 'tag-dev' });
  available.forEach(tag => {
    const isActive = u.activeTag === tag.key;
    const div = document.createElement('div');
    div.className = 'wardrobe-option' + (isActive ? ' active' : '');
    div.innerHTML = `<span><span class="tag-badge ${tag.cls}">${tag.label}</span></span>${isActive ? '<span class="wardrobe-equipped"><i class="fa-solid fa-check"></i> equipped</span>' : ''}`;
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
    toast(tagKey ? `equipped: ${tagKey}` : 'tag unequipped');
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

// ---- Scripts ----
async function loadScripts(search = '') {
  try {
    const data = await api('/scripts' + (search ? `?search=${encodeURIComponent(search)}` : ''));
    renderScripts(data.scripts);
    loadTopScripts();
    loadNewsFeed();
  } catch (e) { toast('could not load scripts', true); }
}

async function loadTopScripts() {
  try {
    const data = await api('/scripts/top');
    renderTopScripts(data.scripts);
  } catch(e) {}
}

function renderTopScripts(scripts) {
  const el = $('#topScriptsList');
  if (!scripts.length) { el.innerHTML = '<p class="muted small" style="padding:10px 12px;">no scripts yet</p>'; return; }
  el.innerHTML = scripts.map((s,i) => {
    const rankClass = i===0?'gold':i===1?'silver':i===2?'bronze':'';
    const rankIcon = i===0?'🥇':i===1?'🥈':i===2?'🥉':`#${i+1}`;
    return `<div class="top-script-row" data-id="${s.id}">
      <span class="top-script-rank ${rankClass}">${rankIcon}</span>
      <div class="top-script-info">
        <div class="top-script-title">${esc(s.title)}</div>
        <div class="top-script-installs"><i class="fa-solid fa-download" style="font-size:9px;"></i> ${s.installs||0}</div>
      </div>
    </div>`;
  }).join('');
  el.querySelectorAll('.top-script-row').forEach(row => {
    row.onclick = () => { sfx.click(); loadScriptDetail(row.dataset.id); };
  });
}

async function loadNewsFeed() {
  try {
    const data = await api('/settings');
    const news = data.settings?.news || [];
    const el = $('#newsFeed');
    if (!news.length) {
      el.innerHTML = `<div class="news-item"><div class="news-text">${esc(data.settings?.latestUpdate||'Welcome to ZScripts!')}</div></div>`;
    } else {
      el.innerHTML = news.map(n=>`<div class="news-item"><div class="news-text">${esc(n.text)}</div>${n.date?`<div class="news-date"><i class="fa-regular fa-clock" style="font-size:9px;"></i> ${esc(n.date)}</div>`:''}</div>`).join('');
    }
  } catch(e) {}
}

function renderScripts(scripts) {
  const grid = $('#scriptsGrid');
  const empty = $('#scriptsEmpty');
  if (!scripts.length) { grid.innerHTML=''; empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');
  grid.innerHTML = scripts.map((s,i) => {
    const tagsHtml = (s.tags||[]).slice(0,3).map(t=>`<span class="tag-pill">${esc(t)}</span>`).join('');
    return `<div class="script-card" data-id="${s.id}" style="animation-delay:${i*0.04}s">
      <div class="script-card-top">
        <h3>${esc(s.title)}</h3>
        ${s.language?`<span class="lang">${esc(s.language)}</span>`:''}
      </div>
      ${s.description?`<p>${esc(s.description)}</p>`:''}
      ${tagsHtml?`<div class="script-card-tags">${tagsHtml}</div>`:''}
      <div class="card-footer">
        ${pfpImg(s.author,15)}
        <span>${esc(s.author?.displayName||s.author?.username||'unknown')}</span>
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
  const tagsHtml = (s.tags||[]).map(t=>`<span class="tag-pill">${esc(t)}</span>`).join('');
  el.innerHTML = `
    <div class="script-detail-head">
      <div>
        <h1>${esc(s.title)}</h1>
        ${s.description?`<p style="color:var(--muted);font-size:13px;margin-top:4px;">${esc(s.description)}</p>`:''}
        <div class="script-author" data-username="${esc(s.author?.username||'')}">
          ${pfpImg(s.author,20)}
          <span>${esc(s.author?.displayName||s.author?.username||'unknown')}</span>
          · <span style="color:var(--muted);">${timeAgo(s.createdAt)}</span>
        </div>
        <div class="install-count"><i class="fa-solid fa-download"></i> ${s.installs||0} installs</div>
        ${tagsHtml?`<div style="margin-top:8px;display:flex;gap:4px;flex-wrap:wrap;">${tagsHtml}</div>`:''}
      </div>
      <div class="script-detail-actions">
        <button class="btn-install ripple" id="installBtn"><i class="fa-solid fa-download"></i> install</button>
        <button class="btn-ghost ripple" id="copyBtn"><i class="fa-regular fa-copy"></i> copy</button>
        ${isOwn||isAdmin?`<button class="btn-ghost ripple" id="editScriptBtn"><i class="fa-solid fa-pen"></i> edit</button>`:''}
        ${isOwn||isAdmin?`<button class="btn-danger ripple" id="deleteScriptBtn"><i class="fa-solid fa-trash"></i> delete</button>`:''}
      </div>
    </div>
    <pre class="code-block">${esc(s.code)}</pre>`;

  setupRipples();

  el.querySelector('.script-author').onclick = () => { if (s.author?.username) loadProfile(s.author.username); };

  $('#installBtn').onclick = async () => {
    sfx.install();
    try { await api(`/scripts/${s.id}/install`, { method:'POST' }); } catch(e) {}
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

  if (isOwn||isAdmin) {
    $('#editScriptBtn').onclick = () => { sfx.click(); openScriptModal(s); };
    $('#deleteScriptBtn').onclick = async () => {
      if (!confirm('Delete this script?')) return;
      try {
        await api(`/scripts/${s.id}`, { method:'DELETE' });
        toast('script deleted');
        showView('home'); loadScripts();
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
  $('#scriptFormId').value = script?.id||'';
  $('#scriptModalTitle').innerHTML = `<i class="fa-solid fa-code" style="color:var(--accent);"></i> ${script?'edit script':'create script'}`;
  $('#scriptTitle').value = script?.title||'';
  $('#scriptLanguage').value = script?.language||'';
  $('#scriptDescription').value = script?.description||'';
  $('#scriptTags').value = (script?.tags||[]).join(', ');
  $('#scriptCode').value = script?.code||'';
  $('#scriptFormError').textContent = '';
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
  };
  try {
    const data = id ? await api(`/scripts/${id}`,{method:'PUT',body}) : await api('/scripts',{method:'POST',body});
    closeModal('scriptModalBackdrop');
    toast(id?'script updated!':'script created!');
    if (id) renderScriptDetail(data.script);
    else { showView('home'); loadScripts(); }
  } catch(err) { $('#scriptFormError').innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> ${esc(err.message)}`; sfx.error(); }
};

$('#scriptSearchForm').onsubmit = e => { e.preventDefault(); sfx.click(); loadScripts($('#scriptSearchInput').value.trim()); };

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
        ${tagBadgesHtml(u.tags,u.activeTag)}
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
  el.innerHTML = `
    <div class="profile-head">
      ${pfpImg(user, 56)}
      <div style="flex:1;">
        <div class="profile-name-row">
          <h1>${esc(user.displayName||user.username)}</h1>
          ${tagBadgesHtml(user.tags, user.activeTag)}
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
          ${s.language?`<span class="lang">${esc(s.language)}</span>`:''}
        </div>
        ${s.description?`<p>${esc(s.description)}</p>`:''}
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
  if (isOwn) {
    el.querySelector('#editProfileBtn').onclick = () => renderProfileEdit(el.querySelector('#editProfileArea'));
  }
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
  if (adminVisible) { sfx.open(); loadAdminUsers(); }
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
    if (tab.dataset.admintab==='users') loadAdminUsers(); else loadAdminSettings();
  };
});

async function loadAdminUsers(search='') {
  const body=$('#adminBody');
  body.innerHTML=`<div class="admin-search-row"><input id="adminUserSearch" placeholder="search users..." value="${esc(search)}" /><button id="adminUserSearchBtn">search</button></div><div id="adminUsersList">loading...</div>`;
  $('#adminUserSearchBtn').onclick=()=>loadAdminUsers($('#adminUserSearch').value.trim());
  $('#adminUserSearch').onkeydown=e=>{if(e.key==='Enter')loadAdminUsers($('#adminUserSearch').value.trim());};
  try {
    const data=await api('/admin/users'+(search?`?search=${encodeURIComponent(search)}`:''));
    const list=$('#adminUsersList');
    list.innerHTML=data.users.map(u=>`
      <div class="admin-user-row" data-id="${u.id}">
        ${pfpImg(u,24)}
        <span>${esc(u.displayName||u.username)}</span>
        <span class="muted small">@${esc(u.username)}</span>
        ${tagBadgesHtml(u.tags,u.activeTag)}
        ${u.banned?'<span class="banned-flag"><i class="fa-solid fa-ban"></i> BANNED</span>':''}
      </div>`).join('');
    list.querySelectorAll('.admin-user-row').forEach(row=>{ row.onclick=()=>{ sfx.click(); loadAdminUserDetail(row.dataset.id); }; });
  } catch(e) { $('#adminUsersList').textContent='error loading users'; }
}

async function loadAdminUserDetail(id) {
  const body=$('#adminBody'); body.innerHTML='loading...';
  try {
    const data=await api(`/admin/users/${id}`);
    const u=data.user,scripts=data.scripts;
    body.innerHTML=`
      <button class="admin-detail-back" id="adminBack"><i class="fa-solid fa-arrow-left"></i> back</button>
      <div class="admin-detail-card">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
          ${pfpImg(u,32)}
          <div><div style="font-weight:700;">${esc(u.displayName||u.username)}</div><div class="muted small">${esc(u.email)}</div></div>
        </div>
        <div class="admin-tag-row">
          <label><input type="checkbox" id="tagDev" ${u.tags.dev?'checked':''}> <span class="tag-badge tag-dev">dev</span></label>
          <label><input type="checkbox" id="tagOwner" ${u.tags.owner?'checked':''}> <span class="tag-badge tag-owner">owner</span></label>
          <label><input type="checkbox" id="tagOwnerAccess" ${u.tags.ownerAccess?'checked':''}> owner access</label>
        </div>
        <div style="display:flex;gap:8px;margin-top:8px;">
          <button class="btn-ghost" id="saveTagsBtn"><i class="fa-solid fa-floppy-disk"></i> save tags</button>
          <button class="${u.banned?'btn-ghost':'btn-danger'}" id="banBtn"><i class="fa-solid fa-${u.banned?'check':'ban'}"></i> ${u.banned?'unban':'ban'}</button>
        </div>
      </div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:8px;"><i class="fa-solid fa-code"></i> scripts (${scripts.length})</div>
      ${scripts.map(s=>`<div class="admin-script-row"><span>${esc(s.title)}</span><button class="btn-danger" style="font-size:11px;padding:3px 8px;" data-del="${s.id}"><i class="fa-solid fa-trash"></i></button></div>`).join('')}`;
    $('#adminBack').onclick=()=>{ sfx.click(); loadAdminUsers(); };
    $('#saveTagsBtn').onclick=async()=>{ await api(`/admin/users/${id}/tags`,{method:'POST',body:{dev:$('#tagDev').checked,owner:$('#tagOwner').checked,ownerAccess:$('#tagOwnerAccess').checked}}); toast('tags saved!'); };
    $('#banBtn').onclick=async()=>{ await api(`/admin/users/${id}/${u.banned?'unban':'ban'}`,{method:'POST'}); toast(u.banned?'unbanned':'banned'); loadAdminUsers(); };
    body.querySelectorAll('[data-del]').forEach(btn=>{
      btn.onclick=async()=>{ if(!confirm('Delete script?')) return; await api(`/admin/scripts/${btn.dataset.del}`,{method:'DELETE'}); toast('deleted'); loadAdminUserDetail(id); };
    });
  } catch(e) { body.innerHTML='error: '+e.message; }
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
        loadNewsFeed();
      } catch(err){ $('#settingsError').innerHTML=`<i class="fa-solid fa-triangle-exclamation"></i> ${esc(err.message)}`; sfx.error(); }
    };
  } catch(e){ body.innerHTML='error: '+e.message; }
}

function setupNewsDelBtns() {
  $$('[data-news-del]').forEach(btn=>{ btn.onclick=()=>{ sfx.click(); btn.closest('.news-editor-item').remove(); }; });
}

// ---- Init ----
async function init() {
  const stored = localStorage.getItem('user');
  if (stored && state.token) { try { state.user=JSON.parse(stored); } catch(e){} }
  renderAuthArea();
  setupGoogle();
  setupRipples();

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
    const data=await api('/settings');
    if (data.settings?.version) $('#versionBadge').textContent='v'+data.settings.version;
  } catch(e){}

  loadScripts();
}

init();
