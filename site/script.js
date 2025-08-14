// site/script.js
// Transfer Credibility Dashboard (Cards + List view)
// - Fetches final_rumors_clean.json
// - Filters: search, status, 7-day hotness
// - Sort: hotness | certainty | date | name
// - Views: cards (rich) & list (dense)
// - Expandable Tweets section per cluster

(() => {
  // ---------------------------
  // DOM
  // ---------------------------
  const elSearch       = document.getElementById("searchInput");
  const elStatus       = document.getElementById("statusFilter");
  const elUse7d        = document.getElementById("use7dHotness");
  const elSort         = document.getElementById("sortSelect");
  const elViewMode     = document.getElementById("viewMode");
  const elCards        = document.getElementById("cards");
  const elBuildTag     = document.getElementById("buildTag");
  const elClusterCount = document.getElementById("clusterCount");
  const elTweetCount   = document.getElementById("tweetCount");

  // Fallbacks (HTML also has onerror fallbacks on <img>)
  const FALLBACK_PLAYER_IMG = "assets/ui/defaults/player_silhouette.png";
  const FALLBACK_CLUB_LOGO  = "assets/ui/defaults/club_placeholder.png";

  // ---------------------------
  // Utilities
  // ---------------------------
  const safeNum = (x, d=0) => {
    const n = Number(x);
    return Number.isFinite(n) ? n : d;
  };

  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

  const fmtHot = n => {
    const v = clamp(Math.round(safeNum(n)), 0, 100);
    return String(v);
  };

  const fmtPct = n => {
    const v = clamp(safeNum(n) * 100, 0, 100);
    if (v === 0 || v === 100) return `${Math.round(v)}%`;
    return `${(Math.round(v * 10) / 10).toFixed(1)}%`;
  };

  const fmtDateShort = d => {
    if (!(d instanceof Date) || isNaN(d)) return "—";
    const date = d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    const time = d.toLocaleTimeString(undefined, { hour12: false, hour: "2-digit", minute: "2-digit" });
    return `${date} ${time}`; // e.g., "Jun 10, 2025 16:38"
  };

  const tweetDate = (t) => {
    if (t && t.created_at) {
      const d = new Date(t.created_at);
      if (!isNaN(d)) return d;
    }
    return null;
  };

  const normalizeAsset = (p) => {
    if (!p || typeof p !== "string") return null;
    let v = p.replace(/\\/g, "/").replace(/^\.\/+/,"");
    const idx = v.indexOf("assets/");
    if (idx >= 0) v = v.slice(idx);
    return v;
  };

  const statusKey = (s) => (String(s || "").toLowerCase().replace(/\s+/g, "-"));

  const displayCertainty = (cluster) => {
    const v = Number(cluster?.certainty_score);
    return Number.isFinite(v) ? v : 0;
  };

  const searchHaystack = (c) => [
    c.player_name_display, c.normalized_player_name,
    c.origin_club, c.normalized_origin_club, c.display_origin_club,
    c.destination_club, c.normalized_destination_club
  ].filter(Boolean).join(" ").toLowerCase();

  const topTweet = (c) => {
    const tweets = c?.tweets || [];
    if (!tweets.length) return null;
    const score = (t) => (
      safeNum(t.likes) * 3 +
      safeNum(t.retweets) * 5 +
      safeNum(t.quotes) * 2 +
      safeNum(t.replies) * 2 +
      safeNum(t.bookmarks) * 1 +
      safeNum(t.views) * 0.01
    );
    let best = tweets[0], bestScore = -1;
    for (const t of tweets) {
      const s = score(t);
      if (s > bestScore) { bestScore = s; best = t; }
    }
    return best;
  };

  // ---------------------------
  // Data
  // ---------------------------
  function processRumors(raw) {
    let tweetCount = 0;
    const out = raw.map((r) => {
      const c = { ...r };

      c.player_image_url      = normalizeAsset(c.player_image_url)      || FALLBACK_PLAYER_IMG;
      c.origin_logo_url       = normalizeAsset(c.origin_logo_url)       || FALLBACK_CLUB_LOGO;
      c.destination_logo_url  = normalizeAsset(c.destination_logo_url)  || FALLBACK_CLUB_LOGO;

      const newest = topTweet(c) || (c.tweets && c.tweets[0]) || null;
      const newestDate = newest ? tweetDate(newest) : (c.last_seen_at ? new Date(c.last_seen_at) : null);
      c._lastSeen = newestDate;

      tweetCount += (c.tweets?.length || 0);
      return c;
    });

    return { rows: out, tweetCount };
  }

  // ---------------------------
  // Filtering + Sorting
  // ---------------------------
  function applyFilters(rows) {
    const q = (elSearch.value || "").toLowerCase().trim();
    const status = elStatus.value || "";
    const use7d = elUse7d.checked;
    const sort = elSort.value || "hotness";

    let data = rows;

    if (q) {
      data = data.filter(c => searchHaystack(c).includes(q));
    }
    if (status) {
      data = data.filter(c => (String(c.status_bin || "").toLowerCase() === status.toLowerCase()));
    }

    const keyers = {
      hotness: (c) => Number(use7d ? c.hotness_7d : c.hotness_score) || 0,
      certainty: (c) => displayCertainty(c) || 0,
      date: (c) => (c._lastSeen instanceof Date && !isNaN(c._lastSeen)) ? +c._lastSeen : 0,
      name: (c) => (c.player_name_display || c.normalized_player_name || "").toLowerCase(),
    };

    if (sort === "name") {
      data = [...data].sort((a,b) => keyers.name(a).localeCompare(keyers.name(b)));
    } else {
      data = [...data].sort((a,b) => (keyers[sort](b) - keyers[sort](a)));
    }

    return data;
  }

  // ---------------------------
  // Rendering — Tweets section
  // ---------------------------
  function renderTweetsSection(root, cluster) {
    const details = root.querySelector(".tweet-details");
    if (!details) return;

    const listEl   = details.querySelector(".tweet-list");
    const countEl  = details.querySelector(".tweet-count");
    const sortLbl  = details.querySelector(".tweet-sort-chip");
    const sortSel  = details.querySelector(".tweet-sort");
    const moreBtn  = details.querySelector(".tweet-more");
    const expandBtn= details.querySelector(".tweet-expand");

    const tweets = Array.isArray(cluster.tweets) ? cluster.tweets.slice() : [];
    countEl.textContent = `(${tweets.length})`;

    let mode = "engagement"; // or "newest"
    sortSel.value = mode;

    const engagementScore = (t) =>
      safeNum(t.likes)*3 + safeNum(t.retweets)*5 + safeNum(t.quotes)*2 + safeNum(t.replies)*2 + safeNum(t.bookmarks) + safeNum(t.views)*0.01;

    const resort = () => {
      if (mode === "engagement") {
        tweets.sort((a,b) => engagementScore(b) - engagementScore(a));
      } else {
        tweets.sort((a,b) => (+tweetDate(b) || 0) - (+tweetDate(a) || 0));
      }
    };

    const CHUNK = 5;
    let shown = 0;
    let expanded = false;

    const renderChunk = () => {
      const end = expanded ? tweets.length : Math.min(tweets.length, shown + CHUNK);
      for (let i = shown; i < end; i++) {
        const t = tweets[i];
        const item = document.createElement("div");
        item.className = "tweet-item";

        const text = document.createElement("div");
        text.className = "tweet-text";
        text.textContent = t.tweet_text || "";

        const meta = document.createElement("div");
        meta.className = "tweet-meta";
        const d = tweetDate(t);
        meta.innerHTML = [
          d ? fmtDateShort(d) : "—",
          `♥ ${safeNum(t.likes)}`,
          `⇄ ${safeNum(t.retweets)}`,
          `❝ ${safeNum(t.quotes)}`,
          `💬 ${safeNum(t.replies)}`,
          `🔖 ${safeNum(t.bookmarks)}`,
          (safeNum(t.views) ? `👁 ${safeNum(t.views)}` : null),
          `<a href="${t.tweet_url || `https://twitter.com/i/web/status/${t.tweet_id}`}" target="_blank" rel="noopener noreferrer">Open</a>`
        ].filter(Boolean).join(" · ");

        const right = document.createElement("div");
        right.appendChild(meta);

        item.appendChild(text);
        item.appendChild(right);
        listEl.appendChild(item);
      }
      shown = end;
      moreBtn.hidden = shown >= tweets.length || expanded;
    };

    const rerenderList = () => {
      listEl.innerHTML = "";
      shown = 0;
      resort();
      renderChunk();
    };

    sortSel.addEventListener("change", () => {
      mode = sortSel.value;
      sortLbl.textContent = mode === "engagement" ? "Engagement" : "Newest";
      rerenderList();
    });

    moreBtn.addEventListener("click", () => renderChunk());
    expandBtn.addEventListener("click", () => {
      expanded = !expanded;
      expandBtn.textContent = expanded ? "Collapse" : "Show all";
      rerenderList();
    });

    resort();
    renderChunk();
  }

  // ---------------------------
  // Rendering — Cards
  // ---------------------------
  function renderCards(data) {
    elCards.classList.remove("list-mode");
    elCards.innerHTML = "";
    const tpl = document.getElementById("card-template");
    const frag = document.createDocumentFragment();

    for (const c of data) {
      const node = tpl.content.cloneNode(true);
      const $ = (sel) => node.querySelector(sel);

      $(".player-img").src = c.player_image_url || FALLBACK_PLAYER_IMG;
      $(".player-name").textContent = c.player_name_display || c.normalized_player_name || "Unknown";

      const status = String(c.status_bin || "—");
      const pill = node.querySelector(".status-pill");
      pill.textContent = status;
      pill.className = `status-pill status-${statusKey(status)}`;

      $(".origin-logo").src = c.origin_logo_url || FALLBACK_CLUB_LOGO;
      $(".destination-logo").src = c.destination_logo_url || FALLBACK_CLUB_LOGO;
      $(".origin-name").textContent = c.origin_club || c.normalized_origin_club || "—";
      $(".destination-name").textContent = c.destination_club || c.normalized_destination_club || "—";

      const isSame = (
        (c.normalized_origin_club && c.normalized_destination_club &&
         c.normalized_origin_club === c.normalized_destination_club) ||
        c.is_renewal_or_stay
      );
      if (isSame) {
        const dest = c.destination_club || c.normalized_destination_club || "—";
        const destNameEl = node.querySelector(".destination .club-name");
        destNameEl.textContent = `${dest} (staying)`;
        const arrow = node.querySelector(".arrow");
        arrow && arrow.remove();
      }

      const use7d = elUse7d.checked;
      $(".hotness-value").textContent  = fmtHot(use7d ? c.hotness_7d : c.hotness_score);
      $(".certainty-value").textContent= fmtPct(displayCertainty(c));
      const newest = topTweet(c) || (c.tweets && c.tweets[0]) || null;
      const newestDate = newest ? tweetDate(newest) : (c._lastSeen instanceof Date ? c._lastSeen : null);
      $(".last-seen").textContent = fmtDateShort(newestDate);

      renderTweetsSection(node, c);

      frag.appendChild(node);
    }
    elCards.appendChild(frag);
  }

  // ---------------------------
  // Rendering — List (dense)
  // ---------------------------
  function renderList(data){
    elCards.classList.add("list-mode");
    elCards.innerHTML = "";
    const tpl = document.getElementById("row-template");
    const frag = document.createDocumentFragment();

    for (const c of data){
      const node = tpl.content.cloneNode(true);
      const $ = (sel) => node.querySelector(sel);

      $(".row-avatar").src = c.player_image_url || FALLBACK_PLAYER_IMG;
      $(".row-name").textContent = c.player_name_display || c.normalized_player_name || "Unknown";

      const status = String(c.status_bin || "—");
      const pill = node.querySelector(".status-pill");
      pill.textContent = status;
      pill.className = `status-pill status-${statusKey(status)}`;

      $(".origin-logo").src = c.origin_logo_url || FALLBACK_CLUB_LOGO;
      $(".destination-logo").src = c.destination_logo_url || FALLBACK_CLUB_LOGO;
      $(".origin-name").textContent = c.origin_club || c.normalized_origin_club || "—";
      $(".destination-name").textContent = c.destination_club || c.normalized_destination_club || "—";

      const isSame = (
        (c.normalized_origin_club && c.normalized_destination_club &&
         c.normalized_origin_club === c.normalized_destination_club) ||
        c.is_renewal_or_stay
      );
      if (isSame){
        node.querySelector(".row .arrow")?.remove();
        const dest = c.destination_club || c.normalized_destination_club || "—";
        node.querySelector(".destination .club-name").textContent = `${dest} (staying)`;
      }

      const use7d = elUse7d.checked;
      node.querySelector(".hotness-value").textContent  = fmtHot(use7d ? c.hotness_7d : c.hotness_score);
      node.querySelector(".certainty-value").textContent= fmtPct(displayCertainty(c));
      const newest = topTweet(c) || (c.tweets && c.tweets[0]) || null;
      const newestDate = newest ? tweetDate(newest) : (c._lastSeen instanceof Date ? c._lastSeen : null);
      node.querySelector(".last-seen").textContent = fmtDateShort(newestDate);

      const tt = topTweet(c);
      node.querySelector(".row-sub .row-snippet").textContent = tt ? (tt.tweet_text || "").slice(0,170) + (tt.tweet_text && tt.tweet_text.length>170 ? "…" : "") : "—";

      renderTweetsSection(node, c);

      frag.appendChild(node);
    }
    elCards.appendChild(frag);
  }

  // Dispatcher
  function render(data){
    const mode = elViewMode?.value || "cards";
    if (mode === "list") return renderList(data);
    return renderCards(data);
  }

  // ---------------------------
  // Init
  // ---------------------------
  async function init(){
    try{
      const tag = (window.APP_BUILD || ("dev-" + new Date().toISOString().slice(0,19)));
      if (elBuildTag) elBuildTag.textContent = tag;

      const url = `final_rumors_clean.json?v=${encodeURIComponent(tag)}`;
      const res = await fetch(url, { cache: "no-store" });
      const raw = await res.json();

      const { rows, tweetCount } = processRumors(raw);
      window._rumors = rows;

      elClusterCount.textContent = rows.length.toLocaleString();
      elTweetCount.textContent   = tweetCount.toLocaleString();

      render(applyFilters(rows));

      elSearch.addEventListener("input", () => render(applyFilters(window._rumors)));
      elStatus.addEventListener("change", () => render(applyFilters(window._rumors)));
      elUse7d.addEventListener("change", () => render(applyFilters(window._rumors)));
      elSort.addEventListener("change", () => render(applyFilters(window._rumors)));
      if (elViewMode) elViewMode.addEventListener("change", () => render(applyFilters(window._rumors)));
    } catch (err){
      console.error("Failed to initialize dashboard:", err);
      elCards.innerHTML = `<p style="padding:16px;color:#fca5a5">Failed to load data.</p>`;
    }
  }

  // Go
  init();
})();
