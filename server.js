require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const path = require('path');
const db = require('./db');

const app = express();
app.use(cors());
app.use(express.json({ limit: '8mb' }));

const JWT_SECRET = process.env.JWT_SECRET || 'dev_only_secret_change_me';
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').toLowerCase().trim();
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const PORT = process.env.PORT || 3000;

let googleClient = null;
if (GOOGLE_CLIENT_ID) {
  const { OAuth2Client } = require('google-auth-library');
  googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);
}

function publicUser(u) {
  return {
    id: u.id, username: u.username, displayName: u.displayName,
    pfp: u.pfp || null, bio: u.bio || '', tags: u.tags,
    banned: u.banned, createdAt: u.createdAt
  };
}
function meUser(u) { return { ...publicUser(u), email: u.email }; }

function publicScript(s, author) {
  return {
    id: s.id, title: s.title, description: s.description,
    language: s.language, code: s.code, tags: s.tags || [],
    createdAt: s.createdAt, updatedAt: s.updatedAt,
    installs: s.installs || 0,
    allowCopy: s.allowCopy !== false,
    author: author ? publicUser(author) : null
  };
}

async function getOptionalUser(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return null;
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    return await db.getUserById(payload.id);
  } catch (e) { return null; }
}

function makeToken(user) {
  return jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '30d' });
}

function applyAdminBootstrap(user) {
  if (ADMIN_EMAIL && user.email.toLowerCase() === ADMIN_EMAIL) {
    user.tags.owner = true;
    user.tags.dev = true;
    user.tags.ownerAccess = true;
    user.banned = false;
  }
}

async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'You need to be logged in for that.' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = await db.getUserById(payload.id);
    if (!user) return res.status(401).json({ error: 'Your session is no longer valid.' });
    if (user.banned) return res.status(403).json({ error: 'Your account has been banned.' });
    req.user = user;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Your session expired, please log in again.' });
  }
}

function requireOwnerAccess(req, res, next) {
  if (!req.user.tags.ownerAccess) return res.status(403).json({ error: 'Owner Access required.' });
  next();
}

// ---- auth ----
app.get('/api/config', (req, res) => {
  res.json({ googleEnabled: !!GOOGLE_CLIENT_ID, googleClientId: GOOGLE_CLIENT_ID });
});

app.post('/api/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !email || !password) return res.status(400).json({ error: 'All fields required.' });
    if (password.length < 6) return res.status(400).json({ error: 'Password needs 6+ characters.' });
    const clean = String(username).trim();
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(clean)) return res.status(400).json({ error: 'Username: 3-20 chars, letters/numbers/underscores only.' });
    const emailLower = String(email).trim().toLowerCase();
    if (await db.getUserByEmail(emailLower)) return res.status(400).json({ error: 'Email already in use.' });
    if (await db.getUserByUsername(clean)) return res.status(400).json({ error: 'Username taken.' });
    const user = {
      id: crypto.randomUUID(), username: clean, displayName: clean,
      email: emailLower, passwordHash: bcrypt.hashSync(password, 10),
      googleId: null, pfp: null, bio: '',
      tags: { dev: false, owner: false, ownerAccess: false },
      activeTag: null,
      banned: false, createdAt: new Date().toISOString()
    };
    applyAdminBootstrap(user);
    await db.createUser(user);
    res.json({ token: makeToken(user), user: meUser(user) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required.' });
    const user = await db.getUserByEmail(String(email).trim().toLowerCase());
    if (!user || !user.passwordHash || !bcrypt.compareSync(password, user.passwordHash))
      return res.status(400).json({ error: 'Incorrect email or password.' });
    if (user.banned) return res.status(403).json({ error: 'Account banned.' });
    applyAdminBootstrap(user);
    await db.updateUser(user.id, { tags: user.tags, banned: user.banned });
    res.json({ token: makeToken(user), user: meUser(user) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/google-login', async (req, res) => {
  try {
    if (!googleClient) return res.status(400).json({ error: 'Google sign-in not configured.' });
    const { idToken } = req.body;
    if (!idToken) return res.status(400).json({ error: 'Missing Google token.' });
    const ticket = await googleClient.verifyIdToken({ idToken, audience: GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    const emailLower = (payload.email || '').toLowerCase();
    let user = await db.getUserByGoogleId(payload.sub) || await db.getUserByEmail(emailLower);
    if (!user) {
      let base = (payload.given_name || payload.name || 'user').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 16) || 'user';
      let candidate = base, n = 1;
      while (await db.getUserByUsername(candidate)) { candidate = base + n; n++; }
      user = {
        id: crypto.randomUUID(), username: candidate, displayName: payload.name || candidate,
        email: emailLower, passwordHash: null, googleId: payload.sub,
        pfp: payload.picture || null, bio: '',
        tags: { dev: false, owner: false, ownerAccess: false },
        activeTag: null, banned: false, createdAt: new Date().toISOString()
      };
      applyAdminBootstrap(user);
      await db.createUser(user);
    } else {
      if (!user.googleId) await db.updateUser(user.id, { googleId: payload.sub });
      user = await db.getUserById(user.id);
    }
    if (user.banned) return res.status(403).json({ error: 'Account banned.' });
    applyAdminBootstrap(user);
    await db.updateUser(user.id, { tags: user.tags, banned: user.banned });
    res.json({ token: makeToken(user), user: meUser(user) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/me', requireAuth, (req, res) => res.json({ user: meUser(req.user) }));

app.put('/api/me', requireAuth, async (req, res) => {
  try {
    const { displayName, bio, pfp, activeTag } = req.body;
    const updates = {};
    if (typeof displayName === 'string' && displayName.trim()) updates.displayName = displayName.trim().slice(0, 40);
    if (typeof bio === 'string') updates.bio = bio.slice(0, 280);
    if (typeof pfp === 'string') {
      if (pfp.length > 0 && !pfp.startsWith('data:image/')) return res.status(400).json({ error: 'Must be an image.' });
      updates.pfp = pfp.length > 0 ? pfp : null;
    }
    if (typeof activeTag === 'string' || activeTag === null) updates.activeTag = activeTag;
    const user = await db.updateUser(req.user.id, updates);
    res.json({ user: meUser(user) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- users ----
app.get('/api/users', async (req, res) => {
  try {
    const users = await db.getUsers(req.query.search || '');
    res.json({ users: users.map(publicUser) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/users/:username', async (req, res) => {
  try {
    const user = await db.getUserByUsername(req.params.username);
    if (!user) return res.status(404).json({ error: 'User not found.' });
    const scripts = await db.getScriptsByUser(user.id);
    res.json({ user: publicUser(user), scripts: scripts.map(s => publicScript(s, user)) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- scripts ----
app.get('/api/scripts', async (req, res) => {
  try {
    const scripts = await db.getScripts(req.query.search || '');
    const withAuthors = await Promise.all(scripts.map(async s => {
      const author = await db.getUserById(s.userId);
      return publicScript(s, author);
    }));
    res.json({ scripts: withAuthors });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/scripts/top', async (req, res) => {
  try {
    const scripts = await db.getTopScripts(10);
    const withAuthors = await Promise.all(scripts.map(async s => {
      const author = await db.getUserById(s.userId);
      return publicScript(s, author);
    }));
    res.json({ scripts: withAuthors });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/scripts/:id', async (req, res) => {
  try {
    const script = await db.getScriptById(req.params.id);
    if (!script) return res.status(404).json({ error: 'Script not found.' });
    const author = await db.getUserById(script.userId);
    res.json({ script: publicScript(script, author) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/scripts/:id/install', async (req, res) => {
  try {
    const script = await db.getScriptById(req.params.id);
    if (!script) return res.status(404).json({ error: 'Script not found.' });
    if (script.allowCopy === false) {
      const user = await getOptionalUser(req);
      const isOwner = user && user.id === script.userId;
      const isAdmin = user?.tags?.ownerAccess;
      if (!isOwner && !isAdmin) return res.status(403).json({ error: 'The creator has disabled downloading for this script.' });
    }
    await db.incrementInstalls(req.params.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/scripts', requireAuth, async (req, res) => {
  try {
    const { title, description, language, code, tags, allowCopy } = req.body;
    if (!title || !code) return res.status(400).json({ error: 'Title and code required.' });
    if (title.length > 80) return res.status(400).json({ error: 'Title too long.' });
    if (code.length > 200000) return res.status(400).json({ error: 'Script too large.' });
    const script = {
      id: crypto.randomUUID(), userId: req.user.id,
      title: title.trim(), description: (description || '').slice(0, 400),
      language: (language || 'plaintext').slice(0, 30), code,
      tags: Array.isArray(tags) ? tags.slice(0, 5).map(t => String(t).slice(0, 20)) : [],
      allowCopy: typeof allowCopy === 'boolean' ? allowCopy : true,
      installs: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    };
    await db.createScript(script);
    res.json({ script: publicScript(script, req.user) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/scripts/:id', requireAuth, async (req, res) => {
  try {
    const script = await db.getScriptById(req.params.id);
    if (!script) return res.status(404).json({ error: 'Script not found.' });
    if (script.userId !== req.user.id && !req.user.tags.ownerAccess)
      return res.status(403).json({ error: "Can't edit someone else's script." });
    const { title, description, language, code, tags, allowCopy } = req.body;
    const updates = { updatedAt: new Date().toISOString() };
    if (typeof title === 'string' && title.trim()) updates.title = title.trim().slice(0, 80);
    if (typeof description === 'string') updates.description = description.slice(0, 400);
    if (typeof language === 'string') updates.language = language.slice(0, 30);
    if (typeof code === 'string' && code.length <= 200000) updates.code = code;
    if (Array.isArray(tags)) updates.tags = tags.slice(0, 5).map(t => String(t).slice(0, 20));
    if (typeof allowCopy === 'boolean') updates.allowCopy = allowCopy;
    const updated = await db.updateScript(req.params.id, updates);
    const author = await db.getUserById(updated.userId);
    res.json({ script: publicScript(updated, author) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/scripts/:id', requireAuth, async (req, res) => {
  try {
    const script = await db.getScriptById(req.params.id);
    if (!script) return res.status(404).json({ error: 'Script not found.' });
    if (script.userId !== req.user.id && !req.user.tags.ownerAccess)
      return res.status(403).json({ error: "Can't delete someone else's script." });
    await db.deleteScript(req.params.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- settings ----
app.get('/api/settings', async (req, res) => {
  try { res.json({ settings: await db.getSettings() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- admin ----
app.get('/api/admin/users', requireAuth, requireOwnerAccess, async (req, res) => {
  try {
    const users = await db.getAllUsersAdmin(req.query.search || '');
    res.json({ users: users.map(meUser) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/users/:id', requireAuth, requireOwnerAccess, async (req, res) => {
  try {
    const user = await db.getUserById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found.' });
    const scripts = await db.getScriptsByUser(user.id);
    res.json({ user: meUser(user), scripts: scripts.map(s => publicScript(s, user)) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/users/:id/ban', requireAuth, requireOwnerAccess, async (req, res) => {
  try {
    const user = await db.getUserById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found.' });
    if (ADMIN_EMAIL && user.email.toLowerCase() === ADMIN_EMAIL)
      return res.status(400).json({ error: "Can't ban the site Owner." });
    await db.updateUser(req.params.id, { banned: true });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/users/:id/unban', requireAuth, requireOwnerAccess, async (req, res) => {
  try {
    await db.updateUser(req.params.id, { banned: false });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/users/:id/tags', requireAuth, requireOwnerAccess, async (req, res) => {
  try {
    const user = await db.getUserById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found.' });
    if (ADMIN_EMAIL && user.email.toLowerCase() === ADMIN_EMAIL)
      return res.status(400).json({ error: "Owner tags are locked." });
    const { dev, owner, ownerAccess } = req.body;
    const tags = { ...user.tags };
    if (typeof dev === 'boolean') tags.dev = dev;
    if (typeof owner === 'boolean') tags.owner = owner;
    if (typeof ownerAccess === 'boolean') tags.ownerAccess = ownerAccess;
    await db.updateUser(req.params.id, { tags });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/scripts/:id', requireAuth, requireOwnerAccess, async (req, res) => {
  try {
    await db.deleteScript(req.params.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/admin/settings', requireAuth, requireOwnerAccess, async (req, res) => {
  try {
    const { version, latestUpdate, news, theme } = req.body;
    const updates = {};
    if (typeof version === 'string') updates.version = version.trim().slice(0, 30);
    if (typeof latestUpdate === 'string') updates.latestUpdate = latestUpdate.slice(0, 2000);
    if (Array.isArray(news)) updates.news = news.slice(0, 10);
    if (theme) updates.theme = theme;
    const settings = await db.updateSettings(updates);
    res.json({ settings });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- static ----
app.use(express.static(__dirname));
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found.' });
  res.sendFile(path.join(__dirname, 'index.html'));
});

db.connect().then(() => {
  app.listen(PORT, () => {
    console.log(`ZScripts running on http://localhost:${PORT}`);
    if (!ADMIN_EMAIL) console.warn('WARNING: ADMIN_EMAIL not set.');
  });
}).catch(err => {
  console.error('MongoDB connection failed:', err);
  process.exit(1);
});
