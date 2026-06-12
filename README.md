# 2026 U.S. Open Pool

A salary-cap fantasy game for the 2026 U.S. Open at Shinnecock Hills (June 18–21). Family members draft a roster of 5 golfers within a $100M cap; each golfer is taken by only one entrant ("sniping" draft). Scores update live during the tournament.

**Stack:** static HTML/CSS/JS hosted on GitHub Pages, with Supabase (free tier) as the database. No build step.

---

## Setup walkthrough

### 1. Supabase

1. Sign up at [supabase.com](https://supabase.com) (free, no card needed).
2. Click **New project**. Name it `us-open-pool`. Pick a region close to you. Set a database password (you won't need it for this app — Supabase just stores it).
3. Wait ~1 minute for the project to spin up.
4. Open **SQL Editor** (left sidebar) → **New query** → paste the contents of [`setup.sql`](setup.sql) → click **Run**. You should see "Success. No rows returned."
5. Open **Settings → API**. Copy:
   - **Project URL** (looks like `https://abc123.supabase.co`)
   - **anon public** key (long string starting with `eyJ…`)

### 2. Configure the site

Open [`config.js`](config.js) in any text editor and paste the two values from step 1.5 in place of the `PASTE_…` strings. Save.

### 3. GitHub

1. Sign in at [github.com](https://github.com). Create a free account if needed.
2. Click **+ → New repository**. Name it `us-open-pool-2026`. Choose **Public**. Don't add a README. Click **Create**.
3. On the new repo page, click **uploading an existing file**.
4. Drag every file in this folder into the upload area (or use **choose your files**). Click **Commit changes**.

### 4. Publish

1. In the repo, go to **Settings → Pages** (left sidebar).
2. Under **Source**, pick **Deploy from a branch**. Branch: **main**, folder: **/ (root)**. Click **Save**.
3. Wait 1–2 minutes. Refresh the Pages page — at the top you'll see your live URL: `https://yourusername.github.io/us-open-pool-2026/`.

Share that link with your family. The admin page is at `…/admin.html`.

### 5. Lock down the admin

1. Open `…/admin.html`. The default passcode is `changeme`.
2. Use the **Admin passcode** section to set a real one. Don't share this with players — it's only for whoever enters results.

---

## Editing things later

- **Golfer prices, names, or the field** → edit [`golfers.json`](golfers.json). Commit and push — site updates in seconds.
- **Scoring system** → edit the `SCORING` array near the top of [`app.js`](app.js) and [`admin.js`](admin.js).
- **Cap or roster size** → edit `SALARY_CAP` / `ROSTER_SIZE` near the top of [`app.js`](app.js).
- **Cutoff time** → easiest via the admin page; or change the row in the `settings` table directly in Supabase.

## Files

| File | What it is |
|------|------------|
| `index.html` + `app.js` | The main pool app — sign in, draft, rosters, leaderboard |
| `admin.html` + `admin.js` | Admin page — enter results, edit cutoff and passcode |
| `golfers.json` | The field of golfers with tiers, costs, and odds |
| `config.js` | Supabase URL + anon key (you fill this in) |
| `setup.sql` | Database schema for Supabase — paste-and-run once |

## Notes

- The Supabase anon key in `config.js` is *intended* to be public — it can only do what Row Level Security in `setup.sql` allows.
- Sign-in is name + passcode. Each entrant picks any passcode they like the first time. No emails, no accounts. Family-pool-grade security.
- Real-time updates: when someone drafts a golfer, everyone else's page updates within a second or two.
