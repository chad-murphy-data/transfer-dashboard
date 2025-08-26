/* Transfer Credibility — client app
   - Fetches final_rumors_clean.json (cache-busted)
   - Cleans & filters data (mega-bin guard, path fixes)
   - Recomputes Hotness (left-censored normal, mean≈25, SD≈25, cap 100)
   - Renders responsive cards with FEATURED TWEET selection (credibility + destination, STRICT)
*/

//////////////////////////////
// Config & constants
//////////////////////////////
const params = new URLSearchParams(location.search);
const JSON_PATH = params.has("featured")
  ? "final_rumors_clean.featured.json"
  : "final_rumors_clean.json";

const FORCE_RESCORE = params.has("rescore") || params.has("nofeatured");

// NEW: strict destination matching when a cluster has a destination
const STRICT_DEST = !params.has("loosydest");

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

const canonicalizeClub = s => {
  if (!s) return null;
  const alias = {
    barca: "barcelona",
    psg: "paris saint-germain",
    "man city": "manchester city",
    city: "manchester city",
    "man utd": "manchester united",
    utd: "manchester united",
    atletico: "atletico madrid",
    rm: "real madrid",
  };
  const key = String(s).trim().toLowerCase();
  return alias[key] ?? key;
};

const snowflakeToDate = id => new Date(Number(BigInt(id) >> 22n) + TWITTER_EPOCH_MS);

const tweetDate = t => {
  if (t.created_at) {
    const d = new Date(t.created_at);
    if (!isNaN(d)) return d;
  }
  if (t.tweet_id) {
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

// robust <img> setter with fallback on 404/MIME errors
function setSafeImage(imgEl, url, fallback) {
  if (!imgEl) return;
  imgEl.loading = "lazy";
  imgEl.referrerPolicy = "no-referrer";
  imgEl.onerror = () => {
    if (imgEl.dataset.fallbackApplied !== "1") {
      imgEl.dataset.fallbackApplied = "1";
      imgEl.src = fallback;
    }
  };
  imgEl.src = url || fallback;
}

//////////////////////////////
// Featured tweet ranking
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

const getHandle = t => {
  let h = t?.source_handle || t?.author || t?.screen_name || t?.user_handle || "";
  h = h.replace(/^https?:\/\/(www\.)?twitter\.com\//i, "");
  if (!h) return "";
  return h.startsWith("@") ? h : ("@" + h);
};

const isSinglePlayerTweet = t => {
  const pc = t.player_count;
  if (pc != null) return Number(pc) === 1;
  if (t.hasOwnProperty("multi_player")) return !t.multi_player;
  if (t.hasOwnProperty("single_player")) return !!t.single_player;
  return true;
};

const samePlayerAsCluster = (t, c) => {
  const clusterPlayer = toLower(c.normalized_player_name || c.player || c.player_name || c.player_name_display);
  if (!clusterPlayer) return true;
  const tweetPlayer = toLower(t.normalized_player_name || t.player || t.player_name);
  return tweetPlayer ? tweetPlayer === clusterPlayer : true;
};

const sameDestAsCluster = (t, c) => {
  const clusterDest = toLower(c.destination_club || c.normalized_destination_club);
  if (!clusterDest) return true; // only enforce when cluster has a destination
  const tweetDest = toLower(t.destination_club || t.dest_club || t.normalized_destination_club);
  if (!tweetDest) return false;  // STRICT: unknown tweet destination ≠ match
  return tweetDest === clusterDest;
};

const isDenialTweet = t => {
  if (t.is_denial != null) return !!t.is_denial;
  const txt = toLower(t.tweet_text || "");
  const patterns = [
    "deal off","not joining","no longer in talks","no agreement","not happening",
    "denies","denied","rejects","ruled out","won't join","will not join"
  ];
  return patterns.some(p => txt.includes(p));
};

function _scoreTweetForCluster(t, c, allowDenial, nowMs) {
  if (!t) return -Infinity;

  const handle = getHandle(t);
  const cred = MITCHARD_WEIGHTS[handle] ?? 0.60;
  const bin  = BIN_SCORE[c.status_bin] ?? 0.70;

  const dest = sameDestAsCluster(t, c) ? 1 : 0;
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

  const denialPenalty = (!allowDenial && isDenialTweet(t)) ? 0.25 : 1.0;

  return (5*cred + 4*bin + 2*dest + 1.5*single + 0.5*eng) * recency * denialPenalty;
}

function pickFeaturedTweet(cluster) {
  const tweets = Array.isArray(cluster.tweets) ? cluster.tweets.filter(t => t && t.tweet_id) : [];
  if (!tweets.length) return null;

  const now = Date.now();
  const status = cluster.status_bin || "Linked";
  const allowDenial = (status === "No Shot");

  // Respect pre-selection unless rescore forced
  if (cluster.featured_tweet_id && !FORCE_RESCORE) {
    const t = tweets.find(x => String(x.tweet_id) === String(cluster.featured_tweet_id));
    if (t && (!STRICT_DEST || sameDestAsCluster(t, cluster))) return t;
  }

  const hasClusterDest = !!toLower(cluster.destination_club || cluster.normalized_destination_club);
  const requireDest = (t) => !STRICT_DEST || !hasClusterDest || sameDestAsCluster(t, cluster);

  // Ordered filters
  const passes = [
    t => samePlayerAsCluster(t, cluster) && requireDest(t) && isSinglePlayerTweet(t) && (allowDenial || !isDenialTweet(t)),
    t => samePlayerAsCluster(t, cluster) && requireDest(t) && (allowDenial || !isDenialTweet(t)),
    // Below would have ignored destination — now requireDest() keeps them aligned if cluster has one
    t => samePlayerAsCluster(t, cluster) && requireDest(t) && isSinglePlayerTweet(t) && (allowDenial || !isDenialTweet(t)),
    t => samePlayerAsCluster(t, cluster) && requireDest(t) && (allowDenial || !isDenialTweet(t)),
    t => requireDest(t) && (allowDenial || !isDenialTweet(t)),
  ];

  for (const keep of passes) {
    const pool = tweets.filter(keep);
    if (!pool.length) continue;

    pool.sort((a,b) => {
      const s = _scoreTweetForCluster(b, cluster, allowDenial, now) - _scoreTweetForCluster(a, cluster, allowDenial, now);
      if (s !== 0) return s;
      const dt = (tweetDate(b)?.getTime() || 0) - (tweetDate(a)?.getTime() || 0);
      if (dt !== 0) return dt;
      const eb = tweetEngagement(b), ea = tweetEngagement(a);
      if (eb !== ea) return eb - ea;
      return String(b.tweet_id).localeCompare(String(a.tweet_id));
    });

    return pool[0] || null;
  }

  return null;
}

//////////////////////////////
// Data processing
//////////////////////////////
function processRumors(rows) {
  let fixed = rows.map(r => {
    // certainty + “Confirmed → 1.0” guard
    let certainty = r.certainty_score === "" ? null : Number(r.certainty_score);
    if (r.status_bin === "Confirmed" && (!Number.isFinite(certainty) || certainty < 0.95)) {
      certainty = 1.0;
    }

    const tweets = Array.isArray(r.tweets) ? r.tweets.map(t => {
      const d = tweetDate(t);
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

    return {
      ...r,
      certainty_score: certainty,
      decayed_certainty: certainty,
      origin_logo_url: normPath(r.origin_logo_url) || null,
      destination_logo_url: normPath(r.destination_logo_url) || null,
      player_image_url: normPath(r.player_image_url) || null,
      normalized_destination_club: canonicalizeClub(r.normalized_destination_club || r.destination_club),
      normalized_origin_club: canonicalizeClub(r.normalized_origin_club || r.origin_club),
      tweets
    };
  });

  // drop mega-bin & absurd clusters
  fixed = fixed.filter(c => {
    const noPlayer = !(c.normalized_player_name && String(c.normalized_player_name).trim());
    const noClubs  = !(c.origin_club && String(c.origin_club).trim()) &&
                     !(c.destination_club && String(c.destination_club).trim());
    const tooMany  = (Array.isArray(c.tweets) && c.tweets.length > MEGACLUSTER_TWEET_CAP);
    return !( (noPlayer && noClubs) || tooMany );
  });

  // hotness overall
  const raw = fixed.map(clusterRawScore);
  const m = mean(raw);
  const s = std(raw, m) || 1;
  fixed = fixed.map((r, i) => ({ ...r, hotness_score: zToHotness((raw[i] - m) / s) }));

  // hotness 7d
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

  // Image fallbacks are applied at render-time via onerror; keep original URLs here
  fixed = fixed.map(r => ({
    ...r,
    origin_logo_url: r.origin_logo_url || FALLBACK_CLUB_LOGO,
    destination_logo_url: r.destination_logo_url || FALLBACK_CLUB_LOGO,
    player_image_url: r.player_image_url || FALLBACK_PLAYER_IMG,
  }));

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

    // Header & images (robust)
    setSafeImage($(".player-img"), c.player_image_url, FALLBACK_PLAYER_IMG);

    const nm = $(".player-name");
    if (nm) nm.textContent = c.player_name_display || c.normalized_player_name || "Unknown player";

    const status = c.status_bin || "—";
    const pill = $(".status-pill");
    if (pill) {
      pill.textContent = status;
      pill.className = `status-pill status-${String(status).toLowerCase().replace(/\s+/g, "-")}`;
    }

    // Clubs (robust logos)
    setSafeImage($(".origin-logo"), c.origin_logo_url, FALLBACK_CLUB_LOGO);
    setSafeImage($(".destination-logo"), c.destination_logo_url, FALLBACK_CLUB_LOGO);

    const oname = $(".origin-name");
    const dname = $(".destination-name");
    if (oname) oname.textContent = c.origin_club || c.normalized_origin_club || "—";
    if (dname) dname.textContent = c.destination_club || c.normalized_destination_club || "—";

    // Metrics
    const use7d = elUse7d && elUse7d.checked;
    const hv = $(".hotness-value");
    const cv = $(".certainty-value");
    if (hv) hv.textContent = fmtHot(use7d ? c.hotness_7d : c.hotness_score);
    if (cv) cv.textContent = fmtPct(c.decayed_certainty ?? c.certainty_score);

    // Last seen
    const ld = $(".last-seen");
    if (ld) ld.textContent = fmtDate(newestTweetDate(c));

    // Featured Tweet (strict dest + guarded)
    const t = pickFeaturedTweet(c);
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
    certainty: (a, b) => (b.decayed_certainty ?? b.certainty_score ?? 0) - (a.decayed_certainty ?? a.certainty_score ?? 0),
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

  if (elSearch) elSearch.addEventListener("input", draw);
  if (elStatus) elStatus.addEventListener("change", draw);
  if (elUse7d)  elUse7d.addEventListener("change", draw);
  if (elSort)   elSort.addEventListener("change", draw);
})();
