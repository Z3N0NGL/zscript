# Z Scripts

A site for sharing scripts/code with you and others. Custom backend (Node.js +
Express), no third-party platform required to run it - it's just your code.

## What's included

- **Browse & search scripts** - homepage search bar + "create script" button
- **Accounts** - email/password sign up, optional real Google sign-in
- **Profiles** - change display name, bio, profile picture; view anyone's
  profile and their scripts via "search users"
- **Tags** - `Dev` and `Owner` badges show next to a person's name everywhere
  on the site. A third tag, `Owner Access`, is invisible publicly but grants
  admin powers (see below)
- **Latest updates button** - shows the current version + a changelog you write
- **Owner Access admin panel** - press `O` anywhere on the site (if your
  account has the Owner Access tag) to open a floating, draggable, resizable,
  fullscreen-able panel where you can:
  - search ALL users, or list every account
  - click into any user to view their full profile, ban/unban them, grant or
    remove the Dev / Owner / Owner Access tags, and delete any of their scripts
  - edit the site's version number and "latest updates" text
  - change the site's layout colors (background, panels, accent colors, text)

## You are always the Owner - here's how

In the server's `.env` file there's a line:

```
ADMIN_EMAIL=you@example.com
```

Whichever email address you put there, **whoever logs in with that exact
email automatically and permanently gets Dev + Owner + Owner Access.** Nobody
else can grant themselves this - it's checked on the server every time
someone logs in. This is what makes the admin system "only you": as long as
you don't share that .env file or that email/password, you're the only person
who can ever have full control, no matter what happens elsewhere on the site.

You CAN also use the admin panel to grant the Dev or Owner *badge* (just the
visual tag) to other people you trust, and even grant other accounts Owner
Access if you want trusted moderators - that's entirely up to you.

## Running it on your own computer (to try it out)

1. Install [Node.js](https://nodejs.org) if you don't have it (just download
   and run the installer, takes 2 minutes).
2. Open a terminal in the `server` folder.
3. Copy `.env.example` to `.env` and open `.env` in a text editor:
   - Set `ADMIN_EMAIL` to the email you'll register with.
   - Set `JWT_SECRET` to any long random string (mash the keyboard).
   - Leave `GOOGLE_CLIENT_ID` blank for now (see Google sign-in section below
     if you want that later).
4. Run:
   ```
   npm install
   npm start
   ```
5. Open `http://localhost:3000` in your browser.
6. Click "log in / sign up" and register with the same email you put in
   `ADMIN_EMAIL`. You'll instantly have Dev + Owner + Owner Access.
7. Press `O` anywhere on the site to open your admin panel.

All your data (users, scripts, settings) is stored in one file:
`server/data.json`. Back it up by just copying that file somewhere safe.

## Putting it live on the internet

You need somewhere to keep the server running 24/7. Good free/cheap options
that work with this exact code, no changes needed:

- **Render.com** (free tier) - connect your GitHub repo, set it as a "Web
  Service", set the root directory to `server`, build command `npm install`,
  start command `npm start`, then add your `.env` values in their
  Environment Variables settings (don't upload the .env file itself).
- **Railway.app** - similar process, very quick.
- Your own VPS - install Node, copy the files over, run `npm start` (ideally
  with something like `pm2` so it restarts automatically).

Whichever you pick, you'll set `ADMIN_EMAIL`, `JWT_SECRET`, and (optionally)
`GOOGLE_CLIENT_ID` as environment variables in their dashboard instead of a
local `.env` file - same idea, just typed into their website instead.

## Turning on real Google sign-in (optional)

Email/password login works with zero extra setup. If you also want a real
"Sign in with Google" button:

1. Go to [console.cloud.google.com](https://console.cloud.google.com), create
   a project (free).
2. Go to "APIs & Services" -> "Credentials" -> "Create Credentials" ->
   "OAuth client ID" -> Application type: "Web application".
3. Under "Authorized JavaScript origins" add the URL your site will run on
   (e.g. `http://localhost:3000` for testing, and your real domain once it's
   live).
4. Copy the generated **Client ID** and put it in `.env` as
   `GOOGLE_CLIENT_ID=...`.
5. Restart the server. The Google button will now appear automatically in
   the login window.

## Project structure

```
zscripts/
  server/          <- the backend, run this
    server.js      <- all routes (auth, scripts, users, admin)
    db.js          <- tiny JSON-file storage layer
    data.json      <- created automatically, this IS your database
    .env.example   <- copy to .env and fill in
    package.json
  public/          <- the website itself, served by the backend
    index.html
    styles.css
    app.js
```

## A couple of honest notes

- This uses a JSON file instead of a "real" database (like Postgres) on
  purpose - it deploys anywhere with zero setup and you can open `data.json`
  in a text editor to see exactly what's stored. It'll comfortably handle a
  personal or community-sized site. If this ever grows into something with
  thousands of active users, that's a good problem to have, and at that point
  migrating to a proper database is a reasonable next step.
- Profile pictures are stored directly as part of each user's data (as
  embedded images), so keep them reasonably small - the upload form already
  blocks anything over ~1.5MB.
