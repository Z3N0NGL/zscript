// db.js - MongoDB version
const { MongoClient } = require('mongodb');

const uri = process.env.MONGODB_URI;
const DB_NAME = 'zscript';

let client = null;
let db = null;

async function connect() {
  if (db) return db;
  client = new MongoClient(uri);
  await client.connect();
  db = client.db(DB_NAME);
  // ensure settings doc exists
  const settings = await db.collection('settings').findOne({ _id: 'main' });
  if (!settings) {
    await db.collection('settings').insertOne({
      _id: 'main',
      version: '1.0.0',
      latestUpdate: 'Welcome to ZScripts! The site just went live.',
      news: [],
      theme: {
        bg: '#090c11', panel: '#0f1318',
        accent: '#ffb000', accent2: '#4db8ff', text: '#dfe3ea'
      }
    });
  }
  return db;
}

// ---- users ----
async function getUsers(search = '') {
  const d = await connect();
  const q = search ? {
    $or: [
      { username: { $regex: search, $options: 'i' } },
      { displayName: { $regex: search, $options: 'i' } }
    ]
  } : {};
  return d.collection('users').find(q).limit(50).toArray();
}

async function getUserById(id) {
  const d = await connect();
  return d.collection('users').findOne({ id });
}

async function getUserByEmail(email) {
  const d = await connect();
  return d.collection('users').findOne({ email: email.toLowerCase() });
}

async function getUserByUsername(username) {
  const d = await connect();
  return d.collection('users').findOne({ username: { $regex: `^${username}$`, $options: 'i' } });
}

async function getUserByGoogleId(googleId) {
  const d = await connect();
  return d.collection('users').findOne({ googleId });
}

async function createUser(user) {
  const d = await connect();
  await d.collection('users').insertOne(user);
  return user;
}

async function updateUser(id, updates) {
  const d = await connect();
  await d.collection('users').updateOne({ id }, { $set: updates });
  return getUserById(id);
}

async function getAllUsersAdmin(search = '') {
  const d = await connect();
  const q = search ? {
    $or: [
      { username: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
      { displayName: { $regex: search, $options: 'i' } }
    ]
  } : {};
  return d.collection('users').find(q).toArray();
}

// ---- scripts ----
async function getScripts(search = '') {
  const d = await connect();
  const q = search ? {
    $or: [
      { title: { $regex: search, $options: 'i' } },
      { description: { $regex: search, $options: 'i' } },
      { language: { $regex: search, $options: 'i' } },
      { tags: { $regex: search, $options: 'i' } }
    ]
  } : {};
  return d.collection('scripts').find(q).sort({ createdAt: -1 }).limit(100).toArray();
}

async function getTopScripts(limit = 10) {
  const d = await connect();
  return d.collection('scripts').find({}).sort({ installs: -1, createdAt: -1 }).limit(limit).toArray();
}

async function getScriptById(id) {
  const d = await connect();
  return d.collection('scripts').findOne({ id });
}

async function getScriptsByUser(userId) {
  const d = await connect();
  return d.collection('scripts').find({ userId }).sort({ createdAt: -1 }).toArray();
}

async function createScript(script) {
  const d = await connect();
  script.installs = 0;
  await d.collection('scripts').insertOne(script);
  return script;
}

async function updateScript(id, updates) {
  const d = await connect();
  await d.collection('scripts').updateOne({ id }, { $set: updates });
  return getScriptById(id);
}

async function incrementInstalls(id) {
  const d = await connect();
  await d.collection('scripts').updateOne({ id }, { $inc: { installs: 1 } });
}

async function deleteScript(id) {
  const d = await connect();
  await d.collection('scripts').deleteOne({ id });
}

// ---- settings ----
async function getSettings() {
  const d = await connect();
  return d.collection('settings').findOne({ _id: 'main' });
}

async function updateSettings(updates) {
  const d = await connect();
  await d.collection('settings').updateOne({ _id: 'main' }, { $set: updates }, { upsert: true });
  return getSettings();
}

module.exports = {
  connect,
  getUsers, getUserById, getUserByEmail, getUserByUsername, getUserByGoogleId,
  createUser, updateUser, getAllUsersAdmin,
  getScripts, getTopScripts, getScriptById, getScriptsByUser,
  createScript, updateScript, deleteScript, incrementInstalls,
  getSettings, updateSettings
};
