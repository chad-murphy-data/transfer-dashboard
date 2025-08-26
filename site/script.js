/* Transfer Credibility — client app
   - Confidence-first + "definitive" tweet picker (HGW/official/etc.)
   - Destination mirrors featured tweet; if missing, infer from text
   - Certainty normalized (Confirmed=100%, explicit 0–1 or 0–100 respected, else bin fallback)
*/

//////////////////////////////
// Config & constants
//////////////////////////////
const params = new URLSearchParams(location.search);
const JSON_PATH = params.has("featured")
  ? "final_rumors_clean.featured.json"
  : "final_rumors_clean.json";

const FORCE_RESCORE = params.has("rescore") || params.has("nofeatured");

const W = { likes: 1.0, retweets: 2.0, replies: 1.5, quotes: 1.8, bookmarks: 0.5, views: 0.01 };
const MEGACLUSTER_TWEET_CAP = 80;
const TWITTER_EPOCH_MS = 1288834974657;

const FALLBACK_PLAYER_IMG = "assets/ui/defaults/player_silhouette.png";
const FALLBACK_CLUB_LOGO  = "assets/ui/defaults/club_placeholder.png";

//////////////////////////////
// DOM
//////////////////////////////
const elCards        = document.getElementById("cards");
const elSearch       = document.getElementById("searchInput");
const elStatus       = document.getElementById("statusFilter");
const elUse7d        = document.getElementById("use7dHotness");
const elSort         = document.getElementById("sortSelect");
const elClusterCount = document.getElementById("clusterCount");
const elTweetCount   = document.getElementById("tweetCount");
const elCardTpl      = document.getElementById("card-template");
const elBuildTag     = document.getElementById("buildTag");

//////////////////////////////
// Utils
//////////////////////////////
const safeNum  = x => (Number.isFinite(Number(x)) ? Number(x) : 0);
const normPath = p => (typeof p === "string" ? p.replaceAll("\\", "/") : null);
const pad2     = n => String(n).padStart(2, "0");
const toLower  = v => (v == null ? "" : String(v).trim().toLowerCase());
const titleCase = s => String(s || "").replace(/\w\S*/g, w => w[0].toUpperCase() + w.slice(1).toLowerCase());

const clubKey = s => String(s || "")
  .toLowerCase()
  .replace(/[^\w\s]/g, " ")
  .replace(/\b(fc|cf|afc|sc|ssc|ac|bk)\b/g, "")
  .replace(/\s+/g, " ")
  .trim();

const snowflakeToDate = id => new Date(Number(BigInt(id) >> 22n) + TWITTER_EPOCH_MS);

const tweetDate = t => {
  if (t?.created_at) {
    const d = new Date(t.created_at);
    if (!isNaN(d)) return d;
  }
  if (t?.tweet_id) {
    const d = snowflakeToDate(t.tweet_id);
    if (!isNaN(d)) return d;
  }
  return null;
};

const newestTweetDate = c => {
  const arr = Array.isArray(c.tweets) ? c.tweets : [];
  let best = null;
  for (const t of arr) {
    const d = tweetDate(t);
    if (d && (!best || d > best)) best = d;
  }
  if (!best && c.last_seen_at) {
    const d = new Date(c.last_seen_at);
    if (!isNaN(d)) best = d;
  }
  return best;
};

const tweetEngagement = t => {
  const likes      = safeNum(t.likes ?? t.like_count ?? t.favorite_count);
  const rts        = safeNum(t.retweets ?? t.retweet_count);
  const replies    = safeNum(t.replies ?? t.reply_count);
  const quotes     = safeNum(t.quotes ?? t.quote_count);
  const bookmarks  = safeNum(t.bookmarks ?? t.bookmark_count);
  const views      = safeNum(t.views ?? t.view_count ?? t.impressions ?? t.impression_count);
  return (
    W.likes     * Math.log1p(likes) +
    W.retweets  * Math.log1p(rts) +
    W.replies   * Math.log1p(replies) +
    W.quotes    * Math.log1p(quotes) +
    W.bookmarks * Math.log1p(bookmarks) +
    W.views     * Math.log1p(views)
  );
};

const clusterRawScore = c => {
  const tweets = Array.isArray(c.tweets) ? c.tweets : [];
  if (!tweets.length) return 0;
  return Math.max(...tweets.map(tweetEngagement));
};

const mean = arr => arr.reduce((a, b) => a + b, 0) / (arr.length || 1);
const std  = (arr, m) => {
  if (arr.length < 2) return 0;
  const v = arr.reduce((s, x) => s + (x - m) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(v);
};

const zToHotness = z => Math.max(0, Math.min(100, 25 + 25 * z));

const fmtPct  = x => (x == null || isNaN(x) ? "—" : `${Math.round(Number(x) * 100)}%`);
const fmtHot  = x => (x == null || isNaN(x) ? "—" : Math.round(x));
const fmtDate = d => (!(d instanceof Date) || isNaN(d))
  ? "—"
  : d.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });

function setSafeImage(imgEl, url, fallback) {
  if (!imgEl) return;
  const src = normPath(url) || fallback;
  imgEl.loading = "lazy";
  imgEl.onerror = () => {
    if (imgEl.dataset.fallbackApplied !== "1") {
      imgEl.dataset.fallbackApplied = "1";
      imgEl.src = fallback;
    }
  };
  imgEl.src = src;
}

//////////////////////////////
// Credibility & bins
//////////////////////////////
const MITCHARD_WEIGHTS = {
  "@FabrizioRomano": 1.00,
  "@David_Ornstein": 0.99,
  "@DiMarzio": 0.97,
  "@Plettigoal": 0.95,
  "@romeoagresti": 0.93,
  "@Santi_J_FM": 0.85,
  "@JulienLaurens": 0.85,
  "@relevo": 0.84,
  "@MelissaReddy_": 0.84,
  "@JacobSteinberg": 0.83,
  "@SamiMokbel81_DM": 0.82,
  "@TheAthleticFC": 0.82,
  "@kerry_hau": 0.80,
  "@Jack_Gaughan": 0.80,
  "@M_S_Alshaikh": 0.80,
  "@A_Bin_Ahmad": 0.80
};

const BIN_SCORE = {
  "Confirmed": 1.00,
  "Imminent": 0.96,
  "Advanced": 0.90,
  "Linked": 0.70,
  "Speculative": 0.50,
  "Ghosted": 0.10,
  "No Shot": 0.05
};

//////////////////////////////
// Confidence & "definitive" detection
//////////////////////////////
const getHandle = t => {
  let h = t?.source_handle || t?.author || t?.screen_name || t?.user_handle || "";
  h = h.replace(/^https?:\/\/(www\.)?twitter\.com\//i, "");
  if (!h) return "";
  return h.startsWith("@") ? h : ("@" + h);
};

const isDenialTweet = t => {
  if (t.is_denial != null) return !!t.is_denial;
  const txt = toLower(t.tweet_text || "");
  return [
    "deal off","not joining","no longer in talks","no agreement","not happening",
    "denies","denied","rejects","ruled out","won't join","will not join"
  ].some(p => txt.includes(p));
};

const isSinglePlayerTweet = t => {
  const pc = t.player_count;
  if (pc != null) return Number(pc) === 1;
  if (Object.prototype.hasOwnProperty.call(t, "multi_player")) return !t.multi_player;
  if (Object.prototype.hasOwnProperty.call(t, "single_player")) return !!t.single_player;
  return true;
};

const samePlayerAsCluster = (t, c) => {
  const clusterPlayer = toLower(c.normalized_player_name || c.player || c.player_name || c.player_name_display);
  if (!clusterPlayer) return true;
  const tweetPlayer = toLower(t.normalized_player_name || t.player || t.player_name);
  return tweetPlayer ? tweetPlayer === clusterPlayer : true;
};

// Textual confidence (0–1), with special-casing for "definitive" language
function confidenceFromText(t) {
  const txt = toLower(t.tweet_text || "");
  let s = 0.30;
  const bump = (re, val) => { if (re.test(txt)) s = Math.max(s, val); };

  // Tier 1: definitive
  bump(/\bhere\s*we\s*go\b/, 1.00);
  bump(/\bofficial(?:ly)?\b/, 0.98);
  bump(/\b(full|total)\s+agreement\b|\bagreement (reached|in place)\b/, 0.96);
  bump(/\bpaperwork\b.*(signed|completed)|\bsigning\b|\bsigned\b/, 0.95);
  bump(/\bmedical\b.*(completed|done|passed)|\bshirt number\b|\bunveiled\b/, 0.94);

  // Tier 2: near-definitive
  bump(/\bimminent\b|\bset to join\b|\bvery close\b|\bclose to\b/, 0.90);
  bump(/\badvanced (talks|negotiations)\b|\bverbal agreement\b/, 0.88);
  bump(/\bfee\b.*(agreed|agreement)|\bdeal\b.*(agreed|in place)/, 0.86);

  // Tier 3: strong signals
  bump(/\bbid (submitted|sent|made)\b|\boffer (made|sent|submitted)\b/, 0.78);
  bump(/\bproposal\b|\bin (talks|negotiations)\b|\bcontacts\b/, 0.72);

  // Low-confidence/linking
  bump(/\binterest(ed)?\b|\bmonitor(ing|ed)\b|\blinked\b|\btarget\b/, 0.55);

  // Emojis that often accompany definitives
  bump(/[🔐✅🤝📝✍️]/, Math.max(s, 0.92));

  if (isDenialTweet(t)) s = Math.min(s, 0.15);
  return s;
}

// Small nudges from destination alignment / mentions (non-decisive)
function destinationNudge(t, c) {
  const cd = c.destination_club || c.normalized_destination_club || "";
  const td = t.destination_club || t.dest_club || t.normalized_destination_club || "";
  if (!cd && !td) return 0;
  if (!cd || !td) return 0.03;
  const A = clubKey(cd), B = clubKey(td);
  if (A === B) return 0.12;
  if (A.includes(B) || B.includes(A)) return 0.07;
  return -0.08;
}
function clubMentionNudge(t) {
  const td = t.destination_club || t.dest_club || t.normalized_destination_club || "";
  if (!td) return 0;
  const txt = toLower(t.tweet_text || "");
  const k = clubKey(td);
  return k && txt.includes(k) ? 0.05 : 0;
}

// "Definitive" score used for an override pool (so HGW/official always win)
function definitiveScore(t) {
  const txt = toLower(t.tweet_text || "");
  let d = 0;

  if (/\bhere\s*we\s*go\b/.test(txt)) d = Math.max(d, 1.00);
  if (/\bofficial(?:ly)?\b/.test(txt)) d = Math.max(d, 0.98);
  if (/\b(full|total)\s+agreement\b|\bagreement (reached|in place)\b/.test(txt)) d = Math.max(d, 0.96);
  if (/\bpaperwork\b.*(signed|completed)|\bsigning\b|\bsigned\b/.test(txt)) d = Math.max(d, 0.95);
  if (/\bmedical\b.*(completed|done|passed)|\bshirt number\b|\bunveiled\b/.test(txt)) d = Math.max(d, 0.94);
  if (/[🔐✅🤝📝✍️]/.test(txt)) d = Math.max(d, 0.93);

  // Slight boost if from top source
  const cred = MITCHARD_WEIGHTS[getHandle(t)] ?? 0.60;
  d = Math.max(d, (cred >= 0.95 ? 0.92 : 0));

  if (isDenialTweet(t)) d = Math.min(d, 0.10);
  return d;
}

// Combined score (confidence-first)
function _scoreTweetForCluster(t, c, allowDenial, nowMs) {
  if (!t) return -Infinity;

  const cred = (MITCHARD_WEIGHTS[getHandle(t)] ?? 0.60);
  const bin  = (BIN_SCORE[c.status_bin] ?? 0.70);
  const conf = confidenceFromText(t);
  const single = isSinglePlayerTweet(t) ? 1 : 0;

  const likes = safeNum(t.likes || t.favorite_count);
  const rts   = safeNum(t.retweets || t.retweet_count);
  const quotes= safeNum(t.quotes || t.quote_count);
  const replies = safeNum(t.replies || t.reply_count);
  const bookmarks = safeNum(t.bookmarks || t.bookmark_count);
  const views = safeNum(t.views || t.view_count || t.impressions || t.impression_count);
  const eng = Math.log10(1 + likes + 2*rts + 3*quotes + replies + 0.2*bookmarks + 0.01*views);

  const d = tweetDate(t);
  const ageDays = d ? (nowMs - d.getTime()) / 86400000 : 0;
  const recency = Math.exp(-(isNaN(ageDays) ? 0 : ageDays) / 21);

  const denialPenalty = (!allowDenial && isDenialTweet(t)) ? 0.6 : 1.0;
  const nudges = destinationNudge(t, c) + clubMentionNudge(t);

  // Confidence dominates; credibility next; then bin; destination/mentions are nudges
  return (10*conf + 4*cred + 3*bin + 1.2*single + 0.6*eng + 1.0*nudges) * recency * denialPenalty;
}

function pickFeaturedTweet(cluster) {
  const tweets = Array.isArray(cluster.tweets) ? cluster.tweets.filter(t => t && t.tweet_id) : [];
  if (!tweets.length) return null;

  const now = Date.now();
  const status = cluster.status_bin || "Linked";
  const allowDenial = (status === "No Shot");

  // --- Definitive override pool: if any tweet is 'definitive', pick from that set
  const withDef = tweets
    .filter(t => samePlayerAsCluster(t, cluster) && (allowDenial || !isDenialTweet(t)))
    .map(t => ({ t, def: definitiveScore(t) }));
  const maxDef = withDef.reduce((m, x) => Math.max(m, x.def), 0);
  if (maxDef >= 0.95) {
    const pool = withDef.filter(x => x.def >= maxDef - 0.03).map(x => x.t);
    pool.sort((a,b) => {
      const dt = (tweetDate(b)?.getTime() || 0) - (tweetDate(a)?.getTime() || 0);
      if (dt !== 0) return dt;
      const eb = tweetEngagement(b), ea = tweetEngagement(a);
      if (eb !== ea) return eb - ea;
      return String(b.tweet_id).localeCompare(String(a.tweet_id));
    });
    return pool[0] || null;
  }

  // Otherwise, honor pre-stamped choice unless we're forcing a rescore
  if (cluster.featured_tweet_id && !FORCE_RESCORE) {
    const preset = tweets.find(x => String(x.tweet_id) === String(cluster.featured_tweet_id));
    if (preset) return preset;
  }

  // Confidence-first pool (same player; denials allowed only if cluster is No Shot)
  const pool = tweets.filter(t => samePlayerAsCluster(t, cluster) && (allowDenial || !isDenialTweet(t)));
  if (!pool.length) return tweets[0] || null;

  pool.sort((a,b) => {
    const sb = _scoreTweetForCluster(b, cluster, allowDenial, now);
    const sa = _scoreTweetForCluster(a, cluster, allowDenial, now);
    if (sb !== sa) return sb - sa;
    const dt = (tweetDate(b)?.getTime() || 0) - (tweetDate(a)?.getTime() || 0);
    if (dt !== 0) return dt;
    const eb = tweetEngagement(b), ea = tweetEngagement(a);
    if (eb !== ea) return eb - ea;
    return String(b.tweet_id).localeCompare(String(a.tweet_id));
  });

  return pool[0] || null;
}

//////////////////////////////
// Club index & inference
//////////////////////////////
const CLUB_INDEX = new Map();      // key -> display name
const CLUB_LOGO_INDEX = new Map(); // key -> logo url

function indexClub(name, logoUrl) {
  if (!name) return;
  const key = clubKey(name);
  if (!key) return;
  if (!CLUB_INDEX.has(key) || (name.length > (CLUB_INDEX.get(key)?.length || 0))) {
    CLUB_INDEX.set(key, name);
  }
  if (logoUrl && !CLUB_LOGO_INDEX.has(key)) {
    CLUB_LOGO_INDEX.set(key, logoUrl);
  }
}

function inferDestFromText(t, cluster) {
  const raw  = t?.tweet_text || "";
  const txt  = toLower(raw);
  if (!txt) return null;

  const originKey = clubKey(cluster.origin_club || cluster.normalized_origin_club || "");

  // Pattern: "Real Madrid to pay ... to Liverpool to have Trent"
  // → Dest = first club, Origin = second club
  {
    const m = raw.match(
      /([A-Z][A-Za-z]+(?:\s[A-Z][A-Za-z]+){0,3})\s+to pay[\s\S]+?\s+to\s+([A-Z][A-Za-z]+(?:\s[A-Z][A-Za-z]+){0,3})\s+to have/i
    );
    if (m) {
      const candDest = titleCase(m[1]);
      const candOrig = titleCase(m[2]);
      if (clubKey(candDest) !== originKey) return candDest;
    }
  }

  // Generic: "to/join/signing for/move to/headed to <Club>" — skip known origin
  {
    const m = raw.match(/\b(?:to|join(?:ing)?|sign(?:ing)? for|move to|headed to)\s+([A-Z][A-Za-z]+(?:\s[A-Z][A-Za-z]+){0,3})/);
    if (m) {
      const name = titleCase(m[1]);
      if (clubKey(name) !== originKey) return name;
    }
  }

  // Fallback: longest known club present in text (excluding origin)
  let bestKey = null, bestLen = 0;
  for (const [key, display] of CLUB_INDEX.entries()) {
    if (!key || key === originKey) continue;
    if (txt.includes(key) && key.length > bestLen) { bestKey = key; bestLen = key.length; }
  }
  if (bestKey) return CLUB_INDEX.get(bestKey);

  return null;
}

//////////////////////////////
// Certainty normalization
//////////////////////////////
function normalizeCertainty(cluster) {
  if (cluster.status_bin === "Confirmed") return 1.0;

  let c = cluster.certainty_score;
  if (c === "" || c == null || !Number.isFinite(Number(c))) {
    c = null;
  } else {
    c = Number(c);
    if (c > 1 && c <= 100) c = c / 100;       // accept 0–100
    if (!(c >= 0 && c <= 1)) c = null;
  }

  const fb = Number.isFinite(BIN_SCORE[cluster.status_bin]) ? BIN_SCORE[cluster.status_bin] : 0.70;
  return c == null ? fb : Math.max(c, fb);
}

//////////////////////////////
// Data processing
//////////////////////////////
function processRumors(rows) {
  let fixed = rows.map(r => {
    const tweets = Array.isArray(r.tweets) ? r.tweets.map(t => {
      const d = tweetDate(t);
      // index per-tweet destination (if present)
      if (t.destination_club || t.dest_club || t.normalized_destination_club) {
        indexClub(t.destination_club || t.dest_club || t.normalized_destination_club, t.destination_logo_url);
      }
      return {
        ...t,
        created_at: d ? d.toISOString() : null,
        likes:      safeNum(t.likes),
        retweets:   safeNum(t.retweets),
        replies:    safeNum(t.replies),
        quotes:     safeNum(t.quotes),
        bookmarks:  safeNum(t.bookmarks),
        views:      safeNum(t.views),
        source_handle: t.source_handle || t.author || t.screen_name || t.user_handle || null,
        destination_club: t.destination_club || t.dest_club || t.normalized_destination_club || null,
        player_name: t.player_name || t.normalized_player_name || t.player || null
      };
    }) : [];

    // index cluster clubs into global maps
    indexClub(r.origin_club || r.normalized_origin_club, r.origin_logo_url);
    indexClub(r.destination_club || r.normalized_destination_club, r.destination_logo_url);

    return {
      ...r,
      decayed_certainty: normalizeCertainty(r),
      certainty_score: r.certainty_score === "" ? null : Number(r.certainty_score),
      origin_logo_url: normPath(r.origin_logo_url) || null,
      destination_logo_url: normPath(r.destination_logo_url) || null,
      player_image_url: normPath(r.player_image_url) || null,
      normalized_destination_club: r.normalized_destination_club || r.destination_club || null,
      normalized_origin_club: r.normalized_origin_club || r.origin_club || null,
      tweets
    };
  });

  // Filter out mega-bin & absurd clusters
  fixed = fixed.filter(c => {
    const noPlayer = !(c.normalized_player_name && String(c.normalized_player_name).trim());
    const noClubs  = !(c.origin_club && String(c.origin_club).trim()) &&
                     !(c.destination_club && String(c.destination_club).trim());
    const tooMany  = (Array.isArray(c.tweets) && c.tweets.length > MEGACLUSTER_TWEET_CAP);
    return !( (noPlayer && noClubs) || tooMany );
  });

  // Recompute hotness
  const raw = fixed.map(clusterRawScore);
  const m = mean(raw);
  const s = std(raw, m) || 1;
  fixed = fixed.map((r, i) => ({ ...r, hotness_score: zToHotness((raw[i] - m) / s) }));

  // 7-day hotness
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
  const raw7 = fixed.map(r => {
    const recent = r.tweets.filter(t => {
      const d = tweetDate(t);
      return d && d >= sevenDaysAgo;
    });
    if (!recent.length) return null;
    return Math.max(...recent.map(tweetEngagement));
  });
  const obs7 = raw7.filter(x => x != null);
  if (obs7.length >= 5) {
    const m7 = mean(obs7);
    const s7 = std(obs7, m7) || 1;
    fixed = fixed.map((r, i) => ({
      ...r,
      hotness_7d: raw7[i] == null ? 0 : zToHotness((raw7[i] - m7) / s7),
    }));
  } else {
    fixed = fixed.map(r => ({ ...r, hotness_7d: r.hotness_score }));
  }

  return fixed;
}

//////////////////////////////
// Rendering
//////////////////////////////
function render(data) {
  // Summary
  elClusterCount.textContent = data.length.toLocaleString();
  const tweetTotal = data.reduce((sum, c) => sum + (Array.isArray(c.tweets) ? c.tweets.length : 0), 0);
  elTweetCount.textContent = tweetTotal.toLocaleString();

  // Cards
  elCards.innerHTML = "";
  const frag = document.createDocumentFragment();

  for (const c of data) {
    const node = elCardTpl.content.cloneNode(true);
    const $ = sel => node.querySelector(sel);

    // Player header
    setSafeImage($(".player-img"), c.player_image_url || FALLBACK_PLAYER_IMG, FALLBACK_PLAYER_IMG);
    const nm = $(".player-name");
    if (nm) nm.textContent = c.player_name_display || c.normalized_player_name || "Unknown player";

    const status = c.status_bin || "—";
    const pill = $(".status-pill");
    if (pill) {
      pill.textContent = status;
      pill.className = `status-pill status-${String(status).toLowerCase().replace(/\s+/g, "-")}`;
    }

    // Pick featured tweet first
    const t = pickFeaturedTweet(c);

    // Clubs: origin from cluster; destination prefers tweet field, else inferred from text, else cluster
    setSafeImage($(".origin-logo"), c.origin_logo_url || FALLBACK_CLUB_LOGO, FALLBACK_CLUB_LOGO);
    const oname = $(".origin-name");
    if (oname) oname.textContent = c.origin_club || c.normalized_origin_club || "—";

    const tweetDestField = t?.destination_club || t?.dest_club || t?.normalized_destination_club || null;
    const inferredDest   = !tweetDestField ? inferDestFromText(t, c) : null;
    const destName       = tweetDestField || inferredDest || c.destination_club || c.normalized_destination_club || "—";

    const dname = $(".destination-name");
    if (dname) dname.textContent = destName;

    const destLogo =
      (t && t.destination_logo_url) ||
      CLUB_LOGO_INDEX.get(clubKey(destName)) ||
      c.destination_logo_url ||
      FALLBACK_CLUB_LOGO;

    setSafeImage($(".destination-logo"), destLogo, FALLBACK_CLUB_LOGO);

    // Metrics
    const use7d = elUse7d && elUse7d.checked;
    const hv = $(".hotness-value");
    const cv = $(".certainty-value");
    if (hv) hv.textContent = fmtHot(use7d ? c.hotness_7d : c.hotness_score);
    if (cv) cv.textContent = fmtPct(c.decayed_certainty);

    // Last seen
    const ld = $(".last-seen");
    if (ld) ld.textContent = fmtDate(newestTweetDate(c));

    // Featured Tweet block
    const ft   = $(".featured-tweet");
    const link = $(".tweet-link");
    const text = $(".tweet-text");
    const put  = (cls, val) => { const el = $("." + cls); if (el) el.textContent = val; };

    if (t && ft && link && text) {
      ft.hidden = false;
      link.href = t.tweet_url || `https://twitter.com/i/web/status/${t.tweet_id}`;
      text.textContent = t.tweet_text || "";
      put("likes",     `♥ ${safeNum(t.likes).toLocaleString()}`);
      put("retweets",  `⇄ ${safeNum(t.retweets).toLocaleString()}`);
      put("replies",   `💬 ${safeNum(t.replies).toLocaleString()}`);
      put("quotes",    `❝ ${safeNum(t.quotes).toLocaleString()}`);
      put("bookmarks", `🔖 ${safeNum(t.bookmarks).toLocaleString()}`);
      put("views",     `👁 ${safeNum(t.views).toLocaleString()}`);
    } else if (ft) {
      ft.hidden = true;
      if (link) link.removeAttribute("href");
    }

    frag.appendChild(node);
  }

  elCards.appendChild(frag);
}

//////////////////////////////
// Filters & boot
//////////////////////////////
function applyFilters(rows) {
  const q = (elSearch.value || "").trim().toLowerCase();
  const status = elStatus.value;

  let out = rows;

  if (q) {
    out = out.filter(c => {
      const hay = [
        c.player_name_display, c.normalized_player_name,
        c.origin_club, c.normalized_origin_club,
        c.destination_club, c.normalized_destination_club
      ].filter(Boolean).map(String).join(" ").toLowerCase();
      return hay.includes(q);
    });
  }

  if (status) {
    out = out.filter(c => String(c.status_bin).toLowerCase() === status.toLowerCase());
  }

  const key = elSort.value || "hotness";
  const use7d = elUse7d && elUse7d.checked;
  const cmp = {
    hotness:   (a, b) => (use7d ? b.hotness_7d - a.hotness_7d : b.hotness_score - a.hotness_score),
    certainty: (a, b) => (b.decayed_certainty ?? 0) - (a.decayed_certainty ?? 0),
    date:      (a, b) => (newestTweetDate(b)?.getTime() || 0) - (newestTweetDate(a)?.getTime() || 0),
    name:      (a, b) => (a.player_name_display || a.normalized_player_name || "")
                          .localeCompare(b.player_name_display || b.normalized_player_name || "")
  }[key];

  return out.slice().sort(cmp);
}

(async function init() {
  const now = new Date();
  const bust = (window.APP_BUILD || `${now.getFullYear()}-${pad2(now.getMonth()+1)}-${pad2(now.getDate())}-${Date.now()}`);
  if (elBuildTag) elBuildTag.textContent = String(bust);

  const res = await fetch(`${JSON_PATH}?v=${encodeURIComponent(bust)}`, { cache: "no-store" });
  const raw = await res.json();

  window._rawRumors = raw;
  const ready = processRumors(raw);
  window._rumors = ready;

  const draw = () => render(applyFilters(ready));
  draw();

  elSearch?.addEventListener("input", draw);
  elStatus?.addEventListener("change", draw);
  elUse7d?.addEventListener("change", draw);
  elSort?.addEventListener("change", draw);
})();
