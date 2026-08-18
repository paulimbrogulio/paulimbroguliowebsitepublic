# Paul Imbrogulio — personal site

Four pages: Home, Christmas Letters, Games, and the Cat Project. No build
tools, no framework, no dependencies — just HTML, CSS, and JavaScript, so
you can open any file and edit it yourself.

```
index.html        → Home
letters.html      → Christmas letters (expandable by year)
games.html        → Games list with links to your files
cats.html         → Cat predictions + "where are they now" floor plan
css/style.css     → All styling, in one file
js/cat-data.js    → GENERATED. Every prediction the model can make. Do not hand-edit.
js/cats.js        → Question parsing, answers, floor plan
```

## 1. Preview it on your computer

Double-click `index.html` and it opens in your browser. Everything works
offline, including the cat predictions — that's deliberate (see below).

## 2. Where the cat predictions come from

There is no server. `js/cat-data.js` is a lookup table generated ahead of
time by `export_predictions.py` (which lives one folder up, outside this
site folder, and is *not* uploaded).

The model only ever sees three inputs — hour, 15-minute bin and day of
week — so every question it can be asked was asked offline, and the
answers were written into that file. The browser looks answers up rather
than running the model. That's what makes the site free to host: full
model fidelity, no backend, no monthly bill.

(Daytime answers currently come out the same for every hour between 8am
and 8pm. That's deliberate — the sightings don't show a reliable
hour-by-hour pattern, and the site would rather repeat itself than invent
one. Day versus night is a real difference, and it does show that.)

The file is `.js` rather than `.json` on purpose: browsers block `fetch()`
of local `.json` files, which would break the double-click-to-open
workflow above.

### Refreshing the predictions after new sightings

Everything happens on your computer — the live site can't retrain itself,
because there's no server there to do it. You run one command here, then
re-upload one file.

```
python refresh.py
```

Run it from the folder *above* this one (the folder holding the `.py`
files), not from inside `site`. It downloads the latest form responses,
checks they look right **before** overwriting anything, retrains if the
data actually moved, rebuilds `js/cat-data.js`, and finishes by printing
the path of the one file to re-upload — see step 5.

There are two ways to get the responses to it. Pick one.

#### Option A — let it download the sheet (one-time setup)

**1. Open the responses spreadsheet.** In Google Forms, open the form →
**Responses** tab → the green Sheets icon ("View in Sheets"). That opens
the spreadsheet this project reads.

**2. Share it, as Viewer.** Click **Share** (top right) → under **General
access** change *Restricted* to **Anyone with the link** → then set the
role dropdown beside it to **Viewer** → **Done**.

> **Viewer, not Editor.** The script only ever downloads the file — it
> never writes back, so view access is all it needs. Setting Editor would
> let anyone who ever sees that link rewrite or delete your cat data.
> There is no upside to it. Leave it on Viewer.

> Worth knowing before you do this: "Anyone with the link" means the
> spreadsheet is readable by anyone who has the URL — it isn't listed or
> searchable, but it is no longer private. The contents are timestamps and
> cat locations, with no names or addresses beyond "Paul's desk"-style
> labels, so most people will find that fine. If you'd rather not, use
> **Option B** instead; it needs no sharing change at all and the site
> works identically either way.

**3. Copy the sheet ID out of the address bar.** The URL looks like:

```
https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/edit#gid=0
                                       └──────── this bit ────────┘
```

That middle chunk between `/d/` and `/edit` is the sheet ID. Copy it.

**4. Make your config file.** In the folder above this one, copy
`refresh_config.example.json` and rename the copy to
`refresh_config.json`. Open it and paste your ID over
`REPLACE_WITH_SHEET_ID`, so the line reads:

```json
"sheet_url": "https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/export?format=xlsx"
```

Leave the `/export?format=xlsx` ending exactly as it is — that's what
makes Google hand over the file instead of a web page. Delete the
`deploy_repo` line, or leave it empty, unless you're using git.

`refresh_config.json` lives outside this `site` folder and is never
uploaded, which is deliberate: it points at your real data.

**5. Run it.** `python refresh.py`, any time you want fresh predictions.

#### Option B — download the spreadsheet yourself

No sharing changes, no config file.

1. Open the responses spreadsheet (Forms → **Responses** → the green
   Sheets icon), then **File → Download → Microsoft Excel (.xlsx)**.
   It has to be `.xlsx` — the CSV option in the Forms ⋮ menu won't work,
   and renaming a `.csv` to `.xlsx` won't either.
2. Save it over `Cat sleeping location (Responses).xlsx` in the folder
   above this one, keeping that exact filename.
3. Run `python refresh.py`. With no config it just says it's skipping the
   download and uses the file on disk.

#### What you'll see, and what to do with it

The run prints how the data changed, then the retrain and export output,
then:

```
Re-upload this one file:
  ...\Webapp\site\js\cat-data.js
```

That's the only thing that goes to the website — step 5 covers how.

A few things it might tell you:

- **"nothing new — predictions will be unchanged"** — no new responses
  since last time. That's fine and expected; nothing needs uploading.
- **"Rejected the download — the download is not a readable .xlsx"** —
  almost always the sharing setting from step 2. Google served a sign-in
  page instead of the file. Recheck that it says *Anyone with the link*.
  Your existing spreadsheet is left untouched whenever this happens.
- **"WARNING — raw labels with no bucket mapping"** — a new sleeping spot
  appeared in the form that the site doesn't know which room to put it in.
  The predictions still work; that one spot is being ignored until it's
  added to `BUCKET_MAP` in `export_predictions.py`.

It also writes `Cat sleeping location (Responses).backup.xlsx` — the
previous version of your data, kept in case a download ever goes wrong.

#### One thing to know about "recent"

If nothing new has been logged, a refresh is a genuine no-op — you'll get
a byte-for-byte identical file. The model weights recent sightings more
heavily than old ones, but "recent" is measured against the newest
sighting **in the spreadsheet**, not against today's date. So the
predictions don't quietly drift or go stale while you're not looking; a
site left alone for six months says exactly what it said on day one.

The flip side: that yardstick jumps forward when new responses land. Log
nothing for three months and then add a few, and everything older suddenly
counts for about an eighth of what it did — those few new sightings will
dominate. It's intended (it's how the climbing wall took over the
predictions within weeks), but it can move the answers a lot in one go.
The script prints how far the yardstick moved, so you'll see it coming.

Steady logging avoids the whole issue.

*(`python export_predictions.py` still works on its own if you've already
updated the spreadsheet by hand — `refresh.py` just calls it for you.)*

## 3. Edit the content

All four pages hold real content. Here's how to add to the two that grow.

**Christmas letters** — open `letters.html`. Each year is one `<details>`
block. Copy the whole block, paste it at the top, change the year, and put
each paragraph of the letter in its own `<p>…</p>`. Only the newest block
should have `open` on it — that's what makes it start expanded.

This page carries `<meta name="robots" content="noindex">`, which keeps the
letters out of Google. They're still readable by anyone you send the link
to; they just won't turn up when someone searches a friend's name. Leave it
in place unless you decide otherwise.

**Games** — open `games.html`. Each game is one `.game-card` block. Copy one
per game, then replace the tag, the title, the description, and the Google
Drive (or Dropbox) share link. The grid reflows on its own — you don't need
to touch any layout to fit a third or a tenth.

Set each folder's sharing to **Anyone with the link → Viewer** or people
won't be able to open it — Viewer lets them download, which is all they
need. Don't use Editor; it would let any visitor delete the files.

**A note on the dashed pink boxes**, if you ever see one: the CSS for them
is still here. Any `<div class="slot">…</div>` becomes a visible "replace
this" marker, but only on a page whose `<body>` has `class="drafting"`.
They're hidden by default, so an editing note can't leak onto the live site
by accident — but if you use them, delete `drafting` before you upload.

**Cats** — most of this page is driven by the data file, so there's less
to hand-edit. In `js/cats.js`:
- `PRESETS` — the quick-question chips.
- `SPOT_POINTS` — where each *specific spot* dot sits on the floor plan (the
  climbing wall, Paul's desk, each side of the bed). This is the one to edit
  if a dot looks like it's in the wrong place.
- `BUCKET_POINTS` — one fallback position per room, used only when a spot
  isn't listed in `SPOT_POINTS`.

Both sets of coordinates are read off the shapes drawn in `cats.html`. If you
move a piece of furniture there, move its point here too.
The room names, spot tags, percentages, and accuracy note all come from
`js/cat-data.js` and update themselves when you re-export.

## 4. Put it online (free)

**The full walkthrough is `DEPLOY.txt`, in the folder above this one.**
It's plain text, written to be followed on a fresh computer from nothing,
and it covers the parts that are easy to get wrong. What follows is the
summary.

This folder — the one holding `index.html` — *is* the git repository.
Everything above it (the Python, the model, the spreadsheet) sits outside
it and is therefore never uploaded. That's the design: the protection is
structural, not something you have to remember.

```
git init -b main
git add -A
git ls-files          <-- read this list before committing
git commit -m "Personal site"
git push -u origin main
```

`git ls-files` should show eleven files and no `.xlsx`, no `.pkl`, no
`.py`. **A public repo is permanent** — a file committed once and deleted
later stays in the history and stays downloadable. `DEPLOY.txt` PART 3
covers what to do if the list looks wrong.

The repo must be **Public**: GitHub Pages is only free on public repos.
Then Settings → Pages → *Deploy from a branch* → `main` / `/ (root)`, and
the site is live at `https://<username>.github.io/<repo>/`. **Check it
works there before touching DNS.**

Two files here exist only for hosting: `CNAME` holds the custom domain, and
`.nojekyll` stops GitHub reprocessing the pages. Leave both alone.

<details>
<summary>Fallback: uploading without git</summary>

If git is more trouble than it's worth, the drag-and-drop route still
works. Create the public repo, click *"uploading an existing file"*, and
drag in the *contents* of this folder — `css/` and `js/` go in whole.
Copy the folder somewhere clean first and confirm it contains no `.py`,
no `.pkl` and no `.xlsx`. You lose version history and the ability to
undo, which is the whole reason git is the main route.

</details>

## 5. Point your domain at it

This site takes over `www.paulimbrogulio.com` **and** the bare
`paulimbrogulio.com`, which means it **replaces** the Squarespace site
rather than sitting beside it. Save anything you want off Squarespace
first. Keep paying for the domain registration even if you cancel the
website plan — that's the part you can't get back.

1. GitHub → repo → **Settings → Pages → Custom domain** → enter
   `www.paulimbrogulio.com` → Save. A `CNAME` file holding that name is
   already committed, so the box may be filled in for you. Either way, leave
   the file alone.

   One side effect to expect: because that file is already there, the
   temporary `github.io` address may redirect to `www.paulimbrogulio.com`
   before the DNS records below exist, which looks like a broken site and
   isn't. `DEPLOY.txt` PART 4 explains how to check the pages in the
   meantime.
2. Squarespace → **Settings → Domains** → `paulimbrogulio.com` → **DNS
   Settings**. Delete the whole **Squarespace Defaults** preset first (red
   bin icon on that box — its rows can't be removed individually, and a new
   `@` A record is rejected while they exist), plus the old `cats` custom
   record. Leave *Domain Connect*, *Email Security* and any MX records
   alone. Then, under **Custom records**, add:

   | Name | Type | Data |
   |---|---|---|
   | `@` | A | `185.199.108.153` |
   | `@` | A | `185.199.109.153` |
   | `@` | A | `185.199.110.153` |
   | `@` | A | `185.199.111.153` |
   | `www` | CNAME | `<username>.github.io` |

   Four A records sharing one name is correct — they're GitHub's four
   servers. `<username>` is your **GitHub username**, not the domain, and
   there is no repo name and no `https://` — just `something.github.io`.
   That is the step people get wrong.

   **Still don't change the nameservers**, and leave any MX (email) and
   TXT (verification) records alone.
3. Wait for DNS — usually minutes, occasionally a few hours. Then return
   to GitHub → Settings → Pages and tick **Enforce HTTPS** once the
   certificate has been issued (the checkbox is greyed out until then).

The cat page is now `www.paulimbrogulio.com/cats.html` — a page on the
site, reachable from the nav, not an address of its own.

**Updating later:** edit the file, go to it in the GitHub repo, click the
pencil icon, paste, commit. Or use *Add file → Upload files* to replace
several at once. Don't delete the `CNAME` file.
