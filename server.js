// server.js
// The whole backend for Z Scripts. Read top to bottom - it's organized in
// sections: setup, helpers, auth routes, script routes, user routes,
// admin routes, then static file serving.

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const path = require('path');
const { load, save } = require('./db');

const app = express();
app.use(cors());
app.use(express.json({ limit: '8mb' })); // generous limit so profile picture uploads fit

const JWT_SECRET = process.env.JWT_SECRET || 'dev_only_secret_change_me';
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').toLowerCase().trim();
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const PORT = process.env.PORT || 3000;

let googleClient = null;
if (GOOGLE_CLIENT_ID) {
  const { OAuth2Client } = require('google-auth-library');
  googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);
}

// ---------- small helpers ----------

function publicUser(u) {
  // Never send password hashes to the browser. This is what gets shown
  // to OTHER people viewing a profile.
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    pfp: u.pfp || null,
    bio: u.bio || '',
    tags: u.tags,
    banned: u.banned,
    createdAt: u.createdAt
  };
}

function meUser(u) {
  // What a user gets back about THEMSELVES - includes email.
  return { ...publicUser(u), email: u.email };
}

function publicScript(s, author) {
  return {
    id: s.id,
    title: s.title,
    description: s.description,
    language: s.language,
    code: s.code,
    tags: s.tags || [],
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    author: author ? publicUser(author) : null
  };
}

function makeToken(user) {
  return jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '30d' });
}

function applyAdminBootstrap(user) {
  // Whoever logs in with the ADMIN_EMAIL from .env ALWAYS becomes full Owner.
  // This runs every login/register so nobody can ever lock you out of your
  // own site, even if tags get messed with some other way.
  if (ADMIN_EMAIL && user.email.toLowerCase() === ADMIN_EMAIL) {
    user.tags.owner = true;
    user.tags.dev = true;
    user.tags.ownerAccess = true;
    user.banned = false;
  }
}

// auth middleware - requires a valid login token
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'You need to be logged in for that.' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const data = load();
    const user = data.users.find(u => u.id === payload.id);
    if (!user) return res.status(401).json({ error: 'Your session is no longer valid.' });
    if (user.banned) return res.status(403).json({ error: 'Your account has been banned.' });
    req.user = user;
    req.db = data;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Your session expired, please log in again.' });
  }
}

// admin middleware - requires Owner Access tag specifically
function requireOwnerAccess(req, res, next) {
  if (!req.user.tags.ownerAccess) {
    return res.status(403).json({ error: 'Owner Access required for that.' });
  }
  next();
}

// ---------- auth routes ----------

app.get('/api/config', (req, res) => {
  res.json({ googleEnabled: !!GOOGLE_CLIENT_ID, googleClientId: GOOGLE_CLIENT_ID });
});

app.post('/api/register', (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password) {
    return res.status(400).json({ error: 'Username, email, and password are all required.' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password needs to be at least 6 characters.' });
  }
  const cleanUsername = String(username).trim();
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(cleanUsername)) {
    return res.status(400).json({ error: 'Usernames can only use letters, numbers, and underscores (3-20 characters).' });
  }
  const data = load();
  const emailLower = String(email).trim().toLowerCase();
  if (data.users.some(u => u.email.toLowerCase() === emailLower)) {
    return res.status(400).json({ error: 'An account already exists with that email.' });
  }
  if (data.users.some(u => u.username.toLowerCase() === cleanUsername.toLowerCase())) {
    return res.status(400).json({ error: 'That username is already taken.' });
  }
  const user = {
    id: crypto.randomUUID(),
    username: cleanUsername,
    displayName: cleanUsername,
    email: emailLower,
    passwordHash: bcrypt.hashSync(password, 10),
    googleId: null,
    pfp: null,
    bio: '',
    tags: { dev: false, owner: false, ownerAccess: false },
    banned: false,
    createdAt: new Date().toISOString()
  };
  applyAdminBootstrap(user);
  data.users.push(user);
  save(data);
  res.json({ token: makeToken(user), user: meUser(user) });
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });
  const data = load();
  const user = data.users.find(u => u.email.toLowerCase() === String(email).trim().toLowerCase());
  if (!user || !user.passwordHash || !bcrypt.compareSync(password, user.passwordHash)) {
    return res.status(400).json({ error: 'Incorrect email or password.' });
  }
  if (user.banned) return res.status(403).json({ error: 'This account has been banned.' });
  applyAdminBootstrap(user);
  save(data);
  res.json({ token: makeToken(user), user: meUser(user) });
});

app.post('/api/google-login', async (req, res) => {
  if (!googleClient) return res.status(400).json({ error: 'Google sign-in is not configured on this server.' });
  const { idToken } = req.body;
  if (!idToken) return res.status(400).json({ error: 'Missing Google token.' });
  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({ idToken, audience: GOOGLE_CLIENT_ID });
    payload = ticket.getPayload();
  } catch (e) {
    return res.status(400).json({ error: 'Could not verify Google sign-in.' });
  }
  const data = load();
  const emailLower = (payload.email || '').toLowerCase();
  let user = data.users.find(u => u.googleId === payload.sub || u.email.toLowerCase() === emailLower);
  if (!user) {
    let baseUsername = (payload.given_name || payload.name || 'user').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 16) || 'user';
    let candidate = baseUsername;
    let n = 1;
    while (data.users.some(u => u.username.toLowerCase() === candidate.toLowerCase())) {
      candidate = baseUsername + n;
      n++;
    }
    user = {
      id: crypto.randomUUID(),
      username: candidate,
      displayName: payload.name || candidate,
      email: emailLower,
      passwordHash: null,
      googleId: payload.sub,
      pfp: payload.picture || null,
      bio: '',
      tags: { dev: false, owner: false, ownerAccess: false },
      banned: false,
      createdAt: new Date().toISOString()
    };
    data.users.push(user);
  } else if (!user.googleId) {
    user.googleId = payload.sub;
  }
  if (user.banned) return res.status(403).json({ error: 'This account has been banned.' });
  applyAdminBootstrap(user);
  save(data);
  res.json({ token: makeToken(user), user: meUser(user) });
});

app.get('/api/me', requireAuth, (req, res) => {
  res.json({ user: meUser(req.user) });
});

app.put('/api/me', requireAuth, (req, res) => {
  const { displayName, bio, pfp } = req.body;
  const data = req.db;
  const user = data.users.find(u => u.id === req.user.id);
  if (typeof displayName === 'string' && displayName.trim().length > 0 && displayName.length <= 40) {
    user.displayName = displayName.trim();
  }
  if (typeof bio === 'string') {
    user.bio = bio.slice(0, 280);
  }
  if (typeof pfp === 'string') {
    // pfp arrives as a data: URL (base64) from the browser, or empty string to clear it.
    if (pfp.length > 0 && !pfp.startsWith('data:image/')) {
      return res.status(400).json({ error: 'Profile picture must be an image.' });
    }
    user.pfp = pfp.length > 0 ? pfp : null;
  }
  save(data);
  res.json({ user: meUser(user) });
});

// ---------- user routes ----------

app.get('/api/users', (req, res) => {
  const data = load();
  const search = (req.query.search || '').toLowerCase().trim();
  let users = data.users;
  if (search) {
    users = users.filter(u =>
      u.username.toLowerCase().includes(search) ||
      u.displayName.toLowerCase().includes(search)
    );
  }
  users = users.slice(0, 50).map(publicUser);
  res.json({ users });
});

app.get('/api/users/:username', (req, res) => {
  const data = load();
  const user = data.users.find(u => u.username.toLowerCase() === req.params.username.toLowerCase());
  if (!user) return res.status(404).json({ error: 'No user found with that username.' });
  const scripts = data.scripts
    .filter(s => s.userId === user.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map(s => publicScript(s, user));
  res.json({ user: publicUser(user), scripts });
});

// ---------- script routes ----------

app.get('/api/scripts', (req, res) => {
  const data = load();
  const search = (req.query.search || '').toLowerCase().trim();
  let scripts = data.scripts;
  if (search) {
    scripts = scripts.filter(s =>
      s.title.toLowerCase().includes(search) ||
      (s.description || '').toLowerCase().includes(search) ||
      (s.language || '').toLowerCase().includes(search) ||
      (s.tags || []).some(t => t.toLowerCase().includes(search))
    );
  }
  scripts = scripts
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 100)
    .map(s => {
      const author = data.users.find(u => u.id === s.userId);
      return publicScript(s, author);
    });
  res.json({ scripts });
});

app.get('/api/scripts/:id', (req, res) => {
  const data = load();
  const script = data.scripts.find(s => s.id === req.params.id);
  if (!script) return res.status(404).json({ error: 'Script not found.' });
  const author = data.users.find(u => u.id === script.userId);
  res.json({ script: publicScript(script, author) });
});

app.post('/api/scripts', requireAuth, (req, res) => {
  const { title, description, language, code, tags } = req.body;
  if (!title || !code) return res.status(400).json({ error: 'A title and the code itself are required.' });
  if (title.length > 80) return res.status(400).json({ error: 'Title is too long (80 characters max).' });
  if (code.length > 200000) return res.status(400).json({ error: 'That script is too large.' });
  const data = req.db;
  const script = {
    id: crypto.randomUUID(),
    userId: req.user.id,
    title: title.trim(),
    description: (description || '').slice(0, 400),
    language: (language || 'plaintext').slice(0, 30),
    code,
    tags: Array.isArray(tags) ? tags.slice(0, 5).map(t => String(t).slice(0, 20)) : [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  data.scripts.push(script);
  save(data);
  res.json({ script: publicScript(script, req.user) });
});

app.put('/api/scripts/:id', requireAuth, (req, res) => {
  const data = req.db;
  const script = data.scripts.find(s => s.id === req.params.id);
  if (!script) return res.status(404).json({ error: 'Script not found.' });
  if (script.userId !== req.user.id && !req.user.tags.ownerAccess) {
    return res.status(403).json({ error: "You can't edit someone else's script." });
  }
  const { title, description, language, code, tags } = req.body;
  if (typeof title === 'string' && title.trim()) script.title = title.trim().slice(0, 80);
  if (typeof description === 'string') script.description = description.slice(0, 400);
  if (typeof language === 'string') script.language = language.slice(0, 30);
  if (typeof code === 'string' && code.length <= 200000) script.code = code;
  if (Array.isArray(tags)) script.tags = tags.slice(0, 5).map(t => String(t).slice(0, 20));
  script.updatedAt = new Date().toISOString();
  save(data);
  const author = data.users.find(u => u.id === script.userId);
  res.json({ script: publicScript(script, author) });
});

app.delete('/api/scripts/:id', requireAuth, (req, res) => {
  const data = req.db;
  const script = data.scripts.find(s => s.id === req.params.id);
  if (!script) return res.status(404).json({ error: 'Script not found.' });
  if (script.userId !== req.user.id && !req.user.tags.ownerAccess) {
    return res.status(403).json({ error: "You can't delete someone else's script." });
  }
  data.scripts = data.scripts.filter(s => s.id !== req.params.id);
  save(data);
  res.json({ ok: true });
});

// ---------- public site settings ----------

app.get('/api/settings', (req, res) => {
  const data = load();
  res.json({ settings: data.settings });
});

// ---------- admin-only routes (Owner Access tag required) ----------

app.get('/api/admin/users', requireAuth, requireOwnerAccess, (req, res) => {
  const data = req.db;
  const search = (req.query.search || '').toLowerCase().trim();
  let users = data.users;
  if (search) {
    users = users.filter(u =>
      u.username.toLowerCase().includes(search) ||
      u.email.toLowerCase().includes(search) ||
      u.displayName.toLowerCase().includes(search)
    );
  }
  res.json({ users: users.map(meUser) });
});

app.get('/api/admin/users/:id', requireAuth, requireOwnerAccess, (req, res) => {
  const data = req.db;
  const user = data.users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  const scripts = data.scripts
    .filter(s => s.userId === user.id)
    .map(s => publicScript(s, user));
  res.json({ user: meUser(user), scripts });
});

app.post('/api/admin/users/:id/ban', requireAuth, requireOwnerAccess, (req, res) => {
  const data = req.db;
  const user = data.users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  if (ADMIN_EMAIL && user.email.toLowerCase() === ADMIN_EMAIL) {
    return res.status(400).json({ error: "You can't ban the site Owner." });
  }
  user.banned = true;
  save(data);
  res.json({ user: meUser(user) });
});

app.post('/api/admin/users/:id/unban', requireAuth, requireOwnerAccess, (req, res) => {
  const data = req.db;
  const user = data.users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  user.banned = false;
  save(data);
  res.json({ user: meUser(user) });
});

app.post('/api/admin/users/:id/tags', requireAuth, requireOwnerAccess, (req, res) => {
  const data = req.db;
  const user = data.users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  const { dev, owner, ownerAccess } = req.body;
  if (ADMIN_EMAIL && user.email.toLowerCase() === ADMIN_EMAIL) {
    return res.status(400).json({ error: 'The site Owner\'s tags are locked and always on.' });
  }
  if (typeof dev === 'boolean') user.tags.dev = dev;
  if (typeof owner === 'boolean') user.tags.owner = owner;
  if (typeof ownerAccess === 'boolean') user.tags.ownerAccess = ownerAccess;
  save(data);
  res.json({ user: meUser(user) });
});

app.delete('/api/admin/scripts/:id', requireAuth, requireOwnerAccess, (req, res) => {
  const data = req.db;
  const exists = data.scripts.some(s => s.id === req.params.id);
  if (!exists) return res.status(404).json({ error: 'Script not found.' });
  data.scripts = data.scripts.filter(s => s.id !== req.params.id);
  save(data);
  res.json({ ok: true });
});

app.put('/api/admin/settings', requireAuth, requireOwnerAccess, (req, res) => {
  const data = req.db;
  const { version, latestUpdate, theme } = req.body;
  if (typeof version === 'string' && version.trim()) data.settings.version = version.trim().slice(0, 30);
  if (typeof latestUpdate === 'string') data.settings.latestUpdate = latestUpdate.slice(0, 2000);
  if (theme && typeof theme === 'object') {
    data.settings.theme = { ...data.settings.theme, ...theme };
  }
  save(data);
  res.json({ settings: data.settings });
});

// ---------- serve the frontend ----------

app.use(express.static(__dirname));
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found.' });
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Z Scripts server running on http://localhost:${PORT}`);
  if (!ADMIN_EMAIL) {
    console.warn('WARNING: ADMIN_EMAIL is not set in .env - nobody will automatically become Owner. Set it and restart.');
  }
});
