# Proof Duel

A two-person daily challenge app: log activities with photo proof, keep streaks, and race for the weekly crown.

- `index.html`, `style.css`, `app.js`: the app (no build step)
- `config.js`: your Supabase URL and anon key go here
- `setup.sql`: run once in the Supabase SQL Editor to create the tables, the private photo storage and the security rules
- `manifest.webmanifest` + icons: lets you add it to your phone's home screen

Data and photos live in a free Supabase project. The site is plain static files, so it can be hosted on GitHub Pages, Netlify or any static host.

## Security

- Each phone gets an anonymous Supabase session that can see nothing on its own.
- Players sign in with name + password, checked inside the database (bcrypt hashes in a table the app cannot read; 10 wrong tries locks the account for 15 minutes).
- Row Level Security: only signed-in players can read anything; each player can only add, change or delete their own logs and photos.
- Photos are in a private bucket and shown through signed links that expire after an hour.
- Only two players can ever join.
- Supabase setting needed: Authentication → Sign In / Providers → "Allow anonymous sign-ins" ON.
