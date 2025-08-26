# Transfer Credibility (Client)

**What this is:** a tiny, static web app that turns a raw JSON dump of transfer “clusters” + tweets into a clean, sortable dashboard. No backend. Open with any static server and you’re rolling.

**Why it’s cool**

* **Reporter-aware:** weighs sources (Romano/Ornstein/etc.) so credible voices matter.
* **“Here we go” smart:** automatically promotes definitive tweets (HGW/official/medical done).
* **Continuously confident:** shows a smooth certainty score (not just “0% or 100%”).
* **Destination-aware:** mirrors the featured tweet’s destination, with text inference for tricky phrasing.
* **Fast to iterate:** all logic lives in `script.js`; all content lives in your JSON.

---

## Live demo

* **App:** [https://football-transfer-tracker.netlify.app/]

---

## Quick start

```bash
# any static server works
python3 -m http.server 8080
# or:
npx http-server -p 8080
# open http://localhost:8080
```

**Files**

* `index.html` – markup & card template
* `styles.css` – styles (responsive cards)
* `script.js` – fetch, scoring, selection, render
* `final_rumors_clean.json` – your main dataset
* `final_rumors_clean.featured.json` – optional alternate dataset

If you ever renamed `script.js` during experiments, make sure `index.html` points to the right filename.

---

## URL flags

* Use featured dataset: `?featured=1`
* Force re-score (ignore `featured_tweet_id`): `?rescore=1` (or `?nofeatured=1`)

The app cache-busts on load (`?v=<timestamp>`) so local edits show up.

---

## How it works (in one screenful)

1. **Ingest JSON** of clusters (one per player–move) with a list of tweets.
2. **Normalize + guardrails:** clean paths, drop mega-clusters, compute hotness (overall and last 7d).
3. **Pick featured tweet:** if a tweet is “definitive” (HGW/official/agreement/paperwork/medical), it wins; else a confidence-first score blends text signals, source credibility, recency, and engagement.
4. **Destination label/logo:** taken from the featured tweet when present; otherwise inferred from text; otherwise cluster default.
5. **Certainty:** continuous blend of your `status_bin`, text-confidence from recent credible tweets, and optional `certainty_score`.
6. **Render cards** with search, status filter, and sorting (hotness, certainty, newest, name).

---

## JSON schema (cluster)

```jsonc
{
  "player_name_display": "Kevin De Bruyne",
  "normalized_player_name": "kevin de bruyne",

  "origin_club": "Manchester City",
  "normalized_origin_club": "manchester city",
  "origin_logo_url": "assets/clubs/man-city.png",

  "destination_club": "Napoli",
  "normalized_destination_club": "napoli",
  "destination_logo_url": "assets/clubs/napoli.png",

  "player_image_url": "assets/players/de-bruyne.png",

  "status_bin": "Advanced",            // <- stamp richer bins in your pipeline
  "certainty_score": 0.82,             // optional (0–1 or 0–100 accepted)
  "decayed_certainty": 0.80,           // optional (UI recomputes if missing)

  "featured_tweet_id": "1919319...",   // optional pre-selection
  "last_seen_at": "2025-07-21T12:34:56Z",

  "tweets": [
    {
      "tweet_id": "1919319...",
      "tweet_url": "https://x.com/...",
      "tweet_text": "Trent Alexander-Arnold to Real Madrid, here we go! 🤍🔐",
      "created_at": "2025-05-05T09:13:36Z",

      "likes": 97057, "retweets": 7446, "replies": 2188,
      "quotes": 2062, "bookmarks": 1000, "views": 1234567,

      "source_handle": "@FabrizioRomano",

      "destination_club": "Real Madrid",          // optional but helps a lot
      "destination_logo_url": "assets/clubs/real-madrid.png",

      "single_player": true,                       // or: "player_count": 1
      "is_denial": false
    }
  ]
}
```

### Minimum fields for good results

* Cluster: `player_name_display`, `origin_club`, `destination_club` (or per-tweet destination), `status_bin`, `player_image_url`, both club logos.
* Tweets: `tweet_id`, `tweet_text`, `source_handle`, engagement counts.

Use forward slashes (`/`) in paths; the app normalizes them.

---

## Status bins (data-side policy)

Stamp `status_bin` at the cluster level using this scale:

* `Confirmed` – official/announced/signed/medical done.
* `Imminent` – “here we go”, deal agreed, paperwork/medical scheduled.
* `Advanced` – advanced talks, verbal agreement, fee agreed in principle.
* `Linked` – credible links/bids/offers; talks underway.
* `Speculative` – weak links/monitoring/interest only.
* `Ghosted` – cold/stale or contradictory reporting.
* `No Shot` – reliable denial.

> The pill displays **your** bin. The continuous certainty is used for sorting and comparisons.

---

## Featured tweet selection

* **Definitive override:** “here we go”, “official”, “agreement reached/in place”, “paperwork signed”, “medical done”, etc., always win.
* **Otherwise:** confidence-first scoring (text signals + reporter credibility + recency + engagement) with sensible tiebreakers.
* **Destination mirror:** the card’s destination comes from the featured tweet when available; otherwise text inference handles tricky phrasings (e.g., “X to pay … to Y to have Player” → X = destination).

If you need to hard-pin, add `featured_tweet_id` (optional).

---

## Certainty (continuous)

The displayed percentage blends:

1. **Your `status_bin`** (stable anchor),
2. **Text-based confidence** aggregated from the most recent/credible tweets,
3. **Your `certainty_score`** (if present).

This yields mid-range values (e.g., 62%, 73%, 88%) instead of just “35% or 100%”.

---

## Adding more sources

When you ingest other reporters/outlets:

* Map to the tweet schema above.
* Set `source_handle` (e.g., `@TheAthleticFC`, `@DiMarzio`) so credibility weights apply.
* Whenever a tweet names the destination, set `destination_club` (saves inference).
* Use `single_player: true` or `player_count: 1`.
* Flag denials with `is_denial: true`.
* Most importantly, **stamp richer `status_bin` values** at the cluster level based on the full evidence.

You can tweak credibility weights in `script.js` (`MITCHARD_WEIGHTS`) as your source mix expands.

---

## Sorting, filtering & search

* Sort by **hotness** (overall/7d), **certainty**, **newest**, or **name**.
* Filter by **status bin**.
* Search across player and club names.

---

## Troubleshooting

* **Only “Confirmed” and “Ghosted” showing** → your JSON likely only has those two bins. Start stamping `Linked/Advanced/Imminent/Speculative`.
* **Wrong destination** → make sure the featured tweet has `destination_club`; otherwise the app infers from text (special handling for “to pay … to … to have” phrasing).
* **Headshots/logos missing** → check paths (use `/`). Placeholders show only on image error.
* **Nothing renders** → validate JSON (array of clusters), ensure `index.html` points to `script.js`, and serve via a static server (not `file://`).

---

## Roadmap

* More source adapters & league coverage
* Translation for non-English tweets
* Stronger denial/rebuttal handling
* Compact card mode & density toggle

---

## License

MIT License

---

## Credits

Part of the **Transfer Credibility** project. Built to make silly season a little less silly.
