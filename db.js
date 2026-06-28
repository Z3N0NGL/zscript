// db.js
// A tiny, dependency-free "database" that stores everything in one JSON file.
// This makes the backend easy to inspect, back up (just copy data.json),
// and deploy anywhere without needing a real database server.
//
// Writes are queued so two requests can't corrupt the file by saving at the
// same time.

const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data.json');

function defaultData() {
  return {
    users: [],
    scripts: [],
    settings: {
      version: '1.0.0',
      latestUpdate: 'Welcome to Z Scripts! The site just went live. More features soon.',
      theme: {
        bg: '#0a0e14',
        panel: '#11161f',
        accent: '#ffb000',
        accent2: '#58c4ff',
        text: '#e8e6e1'
      }
    }
  };
}

function load() {
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify(defaultData(), null, 2));
  }
  const raw = fs.readFileSync(DB_PATH, 'utf-8');
  try {
    return JSON.parse(raw);
  } catch (e) {
    console.error('data.json is corrupted, starting fresh. Backup the old file if you need it.');
    const fresh = defaultData();
    fs.writeFileSync(DB_PATH, JSON.stringify(fresh, null, 2));
    return fresh;
  }
}

let writeQueue = Promise.resolve();
function save(data) {
  writeQueue = writeQueue.then(
    () => fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2)),
    () => fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2))
  );
  return writeQueue;
}

module.exports = { load, save };
