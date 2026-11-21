# Proof Duel

A two-person daily challenge app: log activities with photo proof, keep streaks, and race for the weekly crown.

- `index.html`, `style.css`, `app.js`: the app (no build step)
- `config.js`: your Supabase URL and anon key go here
- `setup.sql`: run once in the Supabase SQL Editor to create the tables, the private photo storage and the security rules
- `manifest.webmanifest` + icons: lets you add it to your phone's home screen

Data and photos live in a free Supabase project. The site is plain static files, so it can be hosted on GitHub Pages, Netlify or any static host.

## Security

- Each player has an account (name + password, handled by Supabase Auth).
- Row Level Security: only the two players can read anything; each player can only add, change or delete their own logs and photos.
- Photos are in a private bucket and shown through signed links that expire after an hour.
- The challenge accepts two players only. In Supabase, turn off "Confirm email" (names have no real email address), and once both of you have joined you can also turn off "Allow new users to sign up".
