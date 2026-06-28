// app.js - all frontend logic for Z Scripts.
// Organized in sections: state/api helpers, rendering each view, modals,
// and the Owner Access admin panel at the bottom.

const state = {
  token: localStorage.getItem('zs_token') || null,
  user: null,
  config: { googleEnabled: false, googleClientId: '' }
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

async function api(path, { method = 'GET', body, auth = false } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth && state.token) headers['Authorization'] = 'Bearer ' + state.token;
  const res = await fetch('/api' + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 2600);
}

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function timeAgo(iso) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  return Math.floor(diff / 86400) + 'd ago';
}

function pfpHtml(user, size) {
  if (user && user.pfp) {
    return `<img src="${user.pfp}" style="width:${size}px;height:${size}px" />`;
  }
  const letter = user && user.displayName ? user.displayName[0].toUpperCase() : '?';
  return `<span class="pfp-circle" style="width:${size}px;height:${size}px;display:inline-flex;align-items:center;justify-content:center;color:var(--accent);font-weight:700;">${letter}</span>`;
}

function tagBadges(tags) {
  if (!tags) return '';
  let html = '';
  if (tags.owner) html += `<span class="tag-badge tag-owner">Owner</span>`;
  if (tags.dev) html += `<span class="tag-badge tag-dev">Dev</span>`;
  return html;
}

// ---------- view switching ----------

function showView(id) {
  $$('.view').forEach(v => v.classList.add('hidden'));
  $('#' + id).classList.remove('hidden');
  window.scrollTo(0, 0);
}

$$('[data-nav="home"]').forEach(el => el.addEventListener('click', () => {
  showView('view-home');
  loadScripts();
}));

// ---------- auth state / header ----------

function renderAuthArea() {
  const area = $('#authArea');
  if (!state.user) {
    area.innerHTML = `<button class="btn-ghost" id="loginOpenBtn">log in / sign up</button>`;
    $('#loginOpenBtn').addEventListener('click', () => openModal('authModalBackdrop'));
    return;
  }
  const u = state.user;
  area.innerHTML = `
    <div class="account-pill" id="accountPill">
      ${pfpHtml(u, 26)}
      <span>${escapeHtml(u.displayName)}</span>
      ${tagBadges(u.tags)}
      <div class="account-menu">
        <button id="menuProfileBtn">my profile</button>
        <button id="menuLogoutBtn">log out</button>
      </div>
    </div>
  `;
  const pill = $('#accountPill');
  pill.addEventListener('click', (e) => {
    if (e.target.id === 'menuProfileBtn') {
      pill.classList.remove('open');
      openProfile(u.username);
      return;
    }
    if (e.target.id === 'menuLogoutBtn') {
      pill.classList.remove('open');
      logout();
      return;
    }
    pill.classList.toggle('open');
  });
  document.addEventListener('click', (e) => {
    if (!pill.contains(e.target)) pill.classList.remove('open');
  });
}

function logout() {
  state.token = null;
  state.user = null;
  localStorage.removeItem('zs_token');
  renderAuthArea();
  closeAdminPanel();
  toast('logged out');
  showView('view-home');
}

async function refreshMe() {
  if (!state.token) return;
  try {
    const { user } = await api('/me', { auth: true });
    state.user = user;
  } catch (e) {
    state.token = null;
    state.user = null;
    localStorage.removeItem('zs_token');
  }
  renderAuthArea();
}

// ---------- modals ----------

function openModal(id) { $('#' + id).classList.remove('hidden'); }
function closeModal(id) { $('#' + id).classList.add('hidden'); }

$$('.modal-close').forEach(btn => btn.addEventListener('click', () => closeModal(btn.dataset.close)));
$$('.modal-backdrop').forEach(bd => bd.addEventListener('click', (e) => {
  if (e.target === bd) bd.classList.add('hidden');
}));

// ---------- auth modal tabs ----------

$$('.tab').forEach(tab => tab.addEventListener('click', () => {
  $$('.tab').forEach(t => t.classList.remove('active'));
  tab.classList.add('active');
  $('#loginForm').classList.toggle('hidden', tab.dataset.tab !== 'login');
  $('#registerForm').classList.toggle('hidden', tab.dataset.tab !== 'register');
}));

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#loginError').textContent = '';
  try {
    const data = await api('/login', {
      method: 'POST',
      body: { email: $('#loginEmail').value, password: $('#loginPassword').value }
    });
    onLoggedIn(data);
  } catch (err) {
    $('#loginError').textContent = err.message;
  }
});

$('#registerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#registerError').textContent = '';
  try {
    const data = await api('/register', {
      method: 'POST',
      body: {
        username: $('#registerUsername').value,
        email: $('#registerEmail').value,
        password: $('#registerPassword').value
      }
    });
    onLoggedIn(data);
  } catch (err) {
    $('#registerError').textContent = err.message;
  }
});

function onLoggedIn(data) {
  state.token = data.token;
  state.user = data.user;
  localStorage.setItem('zs_token', data.token);
  closeModal('authModalBackdrop');
  renderAuthArea();
  toast(`welcome, ${data.user.displayName}`);
  if (data.user.tags.ownerAccess) {
    toast('owner access detected - press "O" anytime to open the admin panel');
  }
}

// Google sign in
// We split config fetching from rendering so either can happen first.
async function fetchGoogleConfig() {
  try {
    state.config = await api('/config');
  } catch (e) { /* server might still be booting */ }
}

function renderGoogleButton() {
  if (!state.config.googleEnabled || !state.config.googleClientId) return;
  if (!window.google || !window.google.accounts) return;
  const area = $('#googleLoginArea');
  if (!area) return;
  area.classList.remove('hidden');
  google.accounts.id.initialize({
    client_id: state.config.googleClientId,
    callback: async (response) => {
      try {
        const data = await api('/google-login', { method: 'POST', body: { idToken: response.credential } });
        onLoggedIn(data);
      } catch (err) {
        toast(err.message);
      }
    }
  });
  google.accounts.id.renderButton($('#googleBtnContainer'), {
    theme: 'filled_black',
    size: 'large',
    width: 300,
    text: 'continue_with'
  });
}

async function setupGoogle() {
  await fetchGoogleConfig();
  if (window._googleLibraryLoaded) {
    // Library already loaded before setupGoogle ran
    renderGoogleButton();
  } else {
    // Library will load later — register callback
    window._googleReadyCb = renderGoogleButton;
  }
}

// ---------- scripts: browse / create / view ----------

async function loadScripts(search = '') {
  const { scripts } = await api('/scripts' + (search ? `?search=${encodeURIComponent(search)}` : ''));
  const grid = $('#scriptsGrid');
  $('#scriptsEmpty').classList.toggle('hidden', scripts.length > 0);
  grid.innerHTML = scripts.map(s => `
    <div class="script-card" data-id="${s.id}">
      <h3>${escapeHtml(s.title)}</h3>
      <span class="lang">${escapeHtml(s.language)}</span>
      <p>${escapeHtml(s.description || 'no description provided')}</p>
      <div>${(s.tags || []).map(t => `<span class="tag-pill">${escapeHtml(t)}</span>`).join('')}</div>
      <div class="card-footer">
        ${pfpHtml(s.author, 18)}
        <span>${escapeHtml(s.author ? s.author.displayName : 'unknown')}</span>
        <span>&middot; ${timeAgo(s.createdAt)}</span>
      </div>
    </div>
  `).join('');
  $$('.script-card').forEach(card => card.addEventListener('click', () => openScript(card.dataset.id)));
}

$('#scriptSearchForm').addEventListener('submit', (e) => {
  e.preventDefault();
  showView('view-home');
  loadScripts($('#scriptSearchInput').value.trim());
});

async function openScript(id) {
  const { script: s } = await api('/scripts/' + id);
  showView('view-script');
  const isOwner = state.user && s.author && state.user.id === s.author.id;
  const canDelete = isOwner || (state.user && state.user.tags.ownerAccess);
  $('#scriptDetail').innerHTML = `
    <div class="script-detail-head">
      <div>
        <h1>${escapeHtml(s.title)}</h1>
        <span class="lang">${escapeHtml(s.language)}</span>
        <p class="muted">${escapeHtml(s.description || '')}</p>
        <div>${(s.tags || []).map(t => `<span class="tag-pill">${escapeHtml(t)}</span>`).join('')}</div>
        <div class="script-author" id="scriptAuthorLink">
          ${pfpHtml(s.author, 24)}
          <span>${escapeHtml(s.author ? s.author.displayName : 'unknown')}</span>
          ${tagBadges(s.author && s.author.tags)}
          <span class="muted">&middot; ${timeAgo(s.createdAt)}</span>
        </div>
      </div>
      <div>
        ${isOwner ? `<button class="btn-ghost" id="editScriptBtn">edit</button>` : ''}
        ${canDelete ? `<button class="btn-danger" id="deleteScriptBtn">delete</button>` : ''}
      </div>
    </div>
    <pre class="code-block" id="scriptCodeBlock">${escapeHtml(s.code)}</pre>
    <div class="code-actions">
      <button class="btn-ghost" id="copyCodeBtn">copy code</button>
    </div>
  `;
  if (s.author) {
    $('#scriptAuthorLink').addEventListener('click', () => openProfile(s.author.username));
  }
  $('#copyCodeBtn').addEventListener('click', () => {
    navigator.clipboard.writeText(s.code);
    toast('code copied to clipboard');
  });
  const editBtn = $('#editScriptBtn');
  if (editBtn) editBtn.addEventListener('click', () => openScriptModal(s));
  const delBtn = $('#deleteScriptBtn');
  if (delBtn) delBtn.addEventListener('click', async () => {
    if (!confirm('Delete this script? This cannot be undone.')) return;
    try {
      await api('/scripts/' + s.id, { method: 'DELETE', auth: true });
      toast('script deleted');
      showView('view-home');
      loadScripts();
    } catch (err) { toast(err.message); }
  });
}

function openScriptModal(existing) {
  if (!state.user) { openModal('authModalBackdrop'); return; }
  $('#scriptFormError').textContent = '';
  $('#scriptModalTitle').textContent = existing ? 'edit script' : 'create script';
  $('#scriptFormId').value = existing ? existing.id : '';
  $('#scriptTitle').value = existing ? existing.title : '';
  $('#scriptDescription').value = existing ? existing.description : '';
  $('#scriptLanguage').value = existing ? existing.language : '';
  $('#scriptTags').value = existing ? (existing.tags || []).join(', ') : '';
  $('#scriptCode').value = existing ? existing.code : '';
  openModal('scriptModalBackdrop');
}

$('#createScriptBtn').addEventListener('click', () => openScriptModal(null));

$('#scriptForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#scriptFormError').textContent = '';
  const id = $('#scriptFormId').value;
  const body = {
    title: $('#scriptTitle').value,
    description: $('#scriptDescription').value,
    language: $('#scriptLanguage').value,
    code: $('#scriptCode').value,
    tags: $('#scriptTags').value.split(',').map(t => t.trim()).filter(Boolean)
  };
  try {
    let result;
    if (id) {
      result = await api('/scripts/' + id, { method: 'PUT', auth: true, body });
    } else {
      result = await api('/scripts', { method: 'POST', auth: true, body });
    }
    closeModal('scriptModalBackdrop');
    toast(id ? 'script updated' : 'script created');
    openScript(result.script.id);
  } catch (err) {
    $('#scriptFormError').textContent = err.message;
  }
});

// ---------- search users ----------

$('#searchUsersBtn').addEventListener('click', () => {
  showView('view-users');
  $('#usersList').innerHTML = '';
  $('#userSearchInput').value = '';
  $('#userSearchInput').focus();
  searchUsers('');
});

$('#userSearchForm').addEventListener('submit', (e) => {
  e.preventDefault();
  searchUsers($('#userSearchInput').value.trim());
});

async function searchUsers(q) {
  const { users } = await api('/users' + (q ? `?search=${encodeURIComponent(q)}` : ''));
  $('#usersList').innerHTML = users.map(u => `
    <div class="user-row" data-username="${escapeHtml(u.username)}">
      ${pfpHtml(u, 32)}
      <span class="uname">${escapeHtml(u.displayName)}</span>
      <span class="muted">@${escapeHtml(u.username)}</span>
      ${tagBadges(u.tags)}
    </div>
  `).join('') || `<p class="muted">no users found.</p>`;
  $$('.user-row').forEach(row => row.addEventListener('click', () => openProfile(row.dataset.username)));
}

// ---------- profile ----------

async function openProfile(username) {
  const { user, scripts } = await api('/users/' + encodeURIComponent(username));
  showView('view-profile');
  const isMe = state.user && state.user.username === user.username;
  const canDeleteAny = state.user && state.user.tags.ownerAccess;

  $('#profileContent').innerHTML = `
    <div class="profile-head">
      <span style="display:inline-block;">${pfpHtml(user, 80)}</span>
      <div>
        <div class="profile-name-row">
          <h1>${escapeHtml(user.displayName)}</h1>
          ${tagBadges(user.tags)}
        </div>
        <div class="muted">@${escapeHtml(user.username)} &middot; joined ${new Date(user.createdAt).toLocaleDateString()}</div>
        ${user.bio ? `<div class="profile-bio">${escapeHtml(user.bio)}</div>` : ''}
      </div>
    </div>
    ${isMe ? `<div class="profile-edit-area" id="profileEditArea"></div>` : ''}
    <div class="profile-scripts">
      <h2>scripts (${scripts.length})</h2>
      <div class="scripts-grid" id="profileScriptsGrid"></div>
    </div>
  `;

  $('#profileScriptsGrid').innerHTML = scripts.map(s => `
    <div class="script-card" data-id="${s.id}">
      <h3>${escapeHtml(s.title)}</h3>
      <span class="lang">${escapeHtml(s.language)}</span>
      <p>${escapeHtml(s.description || 'no description provided')}</p>
      <div class="card-footer"><span>${timeAgo(s.createdAt)}</span>
      ${canDeleteAny || isMe ? `<button class="btn-danger" data-delete="${s.id}" style="margin-left:auto;">delete</button>` : ''}
      </div>
    </div>
  `).join('') || `<p class="muted">no scripts yet.</p>`;

  $$('#profileScriptsGrid .script-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.dataset.delete) return;
      openScript(card.dataset.id);
    });
  });
  $$('#profileScriptsGrid [data-delete]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('Delete this script?')) return;
      try {
        await api('/scripts/' + btn.dataset.delete, { method: 'DELETE', auth: true });
        toast('script deleted');
        openProfile(username);
      } catch (err) { toast(err.message); }
    });
  });

  if (isMe) renderProfileEdit(user);
}

function renderProfileEdit(user) {
  const area = $('#profileEditArea');
  area.innerHTML = `
    <h2>edit profile</h2>
    <label class="muted small">display name</label><br/>
    <input type="text" id="editDisplayName" value="${escapeHtml(user.displayName)}" maxlength="40" style="margin:6px 0 12px;width:240px;background:var(--bg);border:1px solid var(--border);color:var(--text);padding:8px;border-radius:4px;" /><br/>
    <label class="muted small">bio</label><br/>
    <textarea id="editBio" maxlength="280" rows="2" style="margin:6px 0 12px;width:100%;max-width:400px;background:var(--bg);border:1px solid var(--border);color:var(--text);padding:8px;border-radius:4px;">${escapeHtml(user.bio || '')}</textarea><br/>
    <label class="muted small">profile picture</label><br/>
    <input type="file" id="editPfpFile" accept="image/*" style="margin:6px 0 12px;" /><br/>
    <button class="btn-primary" id="saveProfileBtn">save changes</button>
    <span class="form-error" id="profileEditError"></span>
  `;
  $('#saveProfileBtn').addEventListener('click', async () => {
    $('#profileEditError').textContent = '';
    const body = {
      displayName: $('#editDisplayName').value,
      bio: $('#editBio').value
    };
    const file = $('#editPfpFile').files[0];
    try {
      if (file) {
        if (file.size > 1500000) throw new Error('Please use an image smaller than ~1.5MB.');
        body.pfp = await fileToDataUrl(file);
      }
      const { user: updated } = await api('/me', { method: 'PUT', auth: true, body });
      state.user = updated;
      renderAuthArea();
      toast('profile updated');
      openProfile(updated.username);
    } catch (err) {
      $('#profileEditError').textContent = err.message;
    }
  });
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ---------- latest updates ----------

$('#updatesBtn').addEventListener('click', async () => {
  const { settings } = await api('/settings');
  $('#updatesVersion').textContent = settings.version;
  $('#updatesText').textContent = settings.latestUpdate;
  openModal('updatesModalBackdrop');
});

async function refreshVersionBadge() {
  try {
    const { settings } = await api('/settings');
    $('#versionBadge').textContent = 'v' + settings.version;
    if (settings.theme) applyTheme(settings.theme);
  } catch (e) { /* ignore */ }
}

function applyTheme(theme) {
  const root = document.documentElement.style;
  if (theme.bg) root.setProperty('--bg', theme.bg);
  if (theme.panel) root.setProperty('--panel', theme.panel);
  if (theme.accent) root.setProperty('--accent', theme.accent);
  if (theme.accent2) root.setProperty('--accent2', theme.accent2);
  if (theme.text) root.setProperty('--text', theme.text);
}

// =====================================================================
// OWNER ACCESS ADMIN PANEL - press "O" to open (only if you have the tag)
// =====================================================================

let adminTab = 'users';
let adminViewingUser = null; // user id currently drilled into

document.addEventListener('keydown', (e) => {
  const tag = document.activeElement.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return; // don't hijack typing
  if (e.key.toLowerCase() !== 'o') return;
  if (!state.user || !state.user.tags.ownerAccess) return;
  toggleAdminPanel();
});

function toggleAdminPanel() {
  const panel = $('#adminPanel');
  if (panel.classList.contains('hidden')) {
    panel.classList.remove('hidden');
    renderAdminBody();
  } else {
    panel.classList.add('hidden');
  }
}
function closeAdminPanel() { $('#adminPanel').classList.add('hidden'); }

$('#adminCloseBtn').addEventListener('click', closeAdminPanel);
$('#adminFullscreenBtn').addEventListener('click', () => {
  $('#adminPanel').classList.toggle('fullscreen');
});

$$('.admin-tab').forEach(tab => tab.addEventListener('click', () => {
  $$('.admin-tab').forEach(t => t.classList.remove('active'));
  tab.classList.add('active');
  adminTab = tab.dataset.admintab;
  adminViewingUser = null;
  renderAdminBody();
}));

// dragging the panel by its header
(function setupDrag() {
  const panel = $('#adminPanel');
  const handle = $('#adminDragHandle');
  let dragging = false, startX, startY, startLeft, startTop;
  handle.addEventListener('mousedown', (e) => {
    if (panel.classList.contains('fullscreen')) return;
    dragging = true;
    startX = e.clientX; startY = e.clientY;
    const rect = panel.getBoundingClientRect();
    startLeft = rect.left; startTop = rect.top;
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    panel.style.left = Math.max(0, startLeft + (e.clientX - startX)) + 'px';
    panel.style.top = Math.max(0, startTop + (e.clientY - startY)) + 'px';
  });
  window.addEventListener('mouseup', () => dragging = false);
})();

async function renderAdminBody() {
  const body = $('#adminBody');
  if (adminTab === 'users') {
    if (adminViewingUser) {
      await renderAdminUserDetail(body, adminViewingUser);
    } else {
      await renderAdminUserList(body, '');
    }
  } else {
    await renderAdminSettings(body);
  }
}

async function renderAdminUserList(body, search) {
  body.innerHTML = `
    <div class="admin-search-row">
      <input type="text" id="adminUserSearch" placeholder="search all users by username/email..." value="${escapeHtml(search)}" />
      <button id="adminUserSearchBtn">search</button>
    </div>
    <div id="adminUserListResults">loading...</div>
  `;
  $('#adminUserSearchBtn').addEventListener('click', () => {
    renderAdminUserList(body, $('#adminUserSearch').value.trim());
  });
  $('#adminUserSearch').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') renderAdminUserList(body, $('#adminUserSearch').value.trim());
  });
  try {
    const { users } = await api('/admin/users' + (search ? `?search=${encodeURIComponent(search)}` : ''), { auth: true });
    $('#adminUserListResults').innerHTML = users.map(u => `
      <div class="admin-user-row" data-id="${u.id}">
        ${pfpHtml(u, 26)}
        <span>${escapeHtml(u.displayName)}</span>
        <span class="muted">@${escapeHtml(u.username)}</span>
        ${tagBadges(u.tags)}
        ${u.banned ? `<span class="banned-flag">BANNED</span>` : ''}
      </div>
    `).join('') || `<p class="muted">no users found.</p>`;
    $$('.admin-user-row', body).forEach(row => row.addEventListener('click', () => {
      adminViewingUser = row.dataset.id;
      renderAdminBody();
    }));
  } catch (err) {
    $('#adminUserListResults').innerHTML = `<p class="form-error">${escapeHtml(err.message)}</p>`;
  }
}

async function renderAdminUserDetail(body, userId) {
  body.innerHTML = `<button class="admin-detail-back" id="adminBackBtn">&larr; back to all users</button><div id="adminUserDetailContent">loading...</div>`;
  $('#adminBackBtn').addEventListener('click', () => { adminViewingUser = null; renderAdminBody(); });
  let data;
  try {
    data = await api('/admin/users/' + userId, { auth: true });
  } catch (err) {
    $('#adminUserDetailContent').innerHTML = `<p class="form-error">${escapeHtml(err.message)}</p>`;
    return;
  }
  const { user, scripts } = data;
  $('#adminUserDetailContent').innerHTML = `
    <div class="admin-detail-card">
      <div style="display:flex;gap:10px;align-items:center;">
        ${pfpHtml(user, 40)}
        <div>
          <div><strong>${escapeHtml(user.displayName)}</strong> @${escapeHtml(user.username)}</div>
          <div class="muted small">${escapeHtml(user.email)}</div>
        </div>
      </div>
      <p class="muted small">joined ${new Date(user.createdAt).toLocaleString()}</p>
      <div class="admin-tag-row">
        <label><input type="checkbox" id="tagDev" ${user.tags.dev ? 'checked' : ''} /> Dev tag</label>
        <label><input type="checkbox" id="tagOwner" ${user.tags.owner ? 'checked' : ''} /> Owner tag</label>
        <label><input type="checkbox" id="tagOwnerAccess" ${user.tags.ownerAccess ? 'checked' : ''} /> Owner Access</label>
      </div>
      <button class="btn-primary" id="saveTagsBtn">save tags</button>
      <span class="form-error" id="tagsError"></span>
      <p class="locked-note small">note: the site's permanent Owner (set via ADMIN_EMAIL on the server) always keeps all 3 tags no matter what's set here.</p>
      <hr style="border-color:var(--border);margin:14px 0;" />
      ${user.banned
        ? `<button class="btn-primary" id="unbanBtn">unban this user</button>`
        : `<button class="btn-danger" id="banBtn">ban this user</button>`}
      <span class="form-error" id="banError"></span>
    </div>
    <h3>their scripts (${scripts.length})</h3>
    <div id="adminUserScripts"></div>
  `;
  $('#adminUserScripts').innerHTML = scripts.map(s => `
    <div class="admin-script-row">
      <span>${escapeHtml(s.title)} <span class="muted small">(${escapeHtml(s.language)})</span></span>
      <button class="btn-danger" data-delscript="${s.id}">delete</button>
    </div>
  `).join('') || `<p class="muted small">no scripts.</p>`;

  $('#saveTagsBtn').addEventListener('click', async () => {
    $('#tagsError').textContent = '';
    try {
      await api(`/admin/users/${userId}/tags`, {
        method: 'POST', auth: true,
        body: {
          dev: $('#tagDev').checked,
          owner: $('#tagOwner').checked,
          ownerAccess: $('#tagOwnerAccess').checked
        }
      });
      toast('tags updated');
      renderAdminUserDetail(body, userId);
    } catch (err) { $('#tagsError').textContent = err.message; }
  });

  const banBtn = $('#banBtn');
  if (banBtn) banBtn.addEventListener('click', async () => {
    try {
      await api(`/admin/users/${userId}/ban`, { method: 'POST', auth: true });
      toast('user banned');
      renderAdminUserDetail(body, userId);
    } catch (err) { $('#banError').textContent = err.message; }
  });
  const unbanBtn = $('#unbanBtn');
  if (unbanBtn) unbanBtn.addEventListener('click', async () => {
    try {
      await api(`/admin/users/${userId}/unban`, { method: 'POST', auth: true });
      toast('user unbanned');
      renderAdminUserDetail(body, userId);
    } catch (err) { $('#banError').textContent = err.message; }
  });
  $$('[data-delscript]', body).forEach(btn => btn.addEventListener('click', async () => {
    if (!confirm('Delete this script?')) return;
    try {
      await api('/admin/scripts/' + btn.dataset.delscript, { method: 'DELETE', auth: true });
      toast('script deleted');
      renderAdminUserDetail(body, userId);
    } catch (err) { toast(err.message); }
  }));
}

async function renderAdminSettings(body) {
  body.innerHTML = `<p>loading...</p>`;
  const { settings } = await api('/settings');
  body.innerHTML = `
    <div class="admin-settings-form">
      <label class="muted small">version</label>
      <input type="text" id="adminVersion" value="${escapeHtml(settings.version)}" />
      <label class="muted small">latest update text (shown in the "latest updates" popup)</label>
      <textarea id="adminLatestUpdate" rows="5">${escapeHtml(settings.latestUpdate)}</textarea>
      <label class="muted small">layout colors</label>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <label class="small muted">background <input type="color" id="themeBg" value="${settings.theme.bg}" /></label>
        <label class="small muted">panel <input type="color" id="themePanel" value="${settings.theme.panel}" /></label>
        <label class="small muted">accent <input type="color" id="themeAccent" value="${settings.theme.accent}" /></label>
        <label class="small muted">accent 2 <input type="color" id="themeAccent2" value="${settings.theme.accent2}" /></label>
        <label class="small muted">text <input type="color" id="themeText" value="${settings.theme.text}" /></label>
      </div>
      <button class="btn-primary" id="saveSettingsBtn">save site settings</button>
      <span class="form-error" id="settingsError"></span>
    </div>
  `;
  $('#saveSettingsBtn').addEventListener('click', async () => {
    $('#settingsError').textContent = '';
    try {
      const { settings: updated } = await api('/admin/settings', {
        method: 'PUT', auth: true,
        body: {
          version: $('#adminVersion').value,
          latestUpdate: $('#adminLatestUpdate').value,
          theme: {
            bg: $('#themeBg').value,
            panel: $('#themePanel').value,
            accent: $('#themeAccent').value,
            accent2: $('#themeAccent2').value,
            text: $('#themeText').value
          }
        }
      });
      applyTheme(updated.theme);
      $('#versionBadge').textContent = 'v' + updated.version;
      toast('site settings saved');
    } catch (err) { $('#settingsError').textContent = err.message; }
  });
}

// ---------- boot ----------

(async function init() {
  await refreshMe();
  renderAuthArea();
  await refreshVersionBadge();
  await loadScripts();
  setupGoogle();
})();
