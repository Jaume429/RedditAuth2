const GEMINI_MODELS = ["gemini-2.5-flash", "gemini-2.5-flash-lite"];
const API_KEY_STORAGE = "redditauth.geminiApiKey";
const RESULTS_STORAGE = "redditauth.lastResults";
const SCAN_COUNT_STORAGE = "redditauth.scanCount";
const AUTOPOST_STORAGE = "redditauth.autopost";
const FETCH_TIMEOUT_MS = 15000;
const DASHBOARD_REFRESH_MS = 30000;
const AUTOPOST_HOUR_LOCAL = 16;

const SUBREDDITS = [
  "SideProject",
  "nocode",
  "Entrepreneur",
  "artificial",
  "ChatGPT",
  "indiehackers",
  "passive_income",
  "ClaudeCode",
  "vibecoding",
  "ClaudeAI",
];

const BLOCKED_SUBREDDITS = new Set([
  "startups",
]);

const SEARCH_QUERIES = [
  "how to build",
  "no code",
  "Claude Code",
  "Claude Code expensive",
  "Claude Code context",
  "token usage",
  "debugging with Claude",
  "Claude app vs Claude Code",
  "launch idea",
  "build without coding",
  "AI to build",
  "ship product",
  "no developer",
  "build app idea",
  "side project",
];

const LANDING_PAGE = "https://veltrostudioo.gumroad.com/l/dicmd";

const SYSTEM_PROMPT = `You are a Reddit-native operator finding ONLY the most relevant reply opportunities for a specific digital product. Your job is strict filtering and writing useful comments that sound like they belong in the thread.

PRODUCT:
- Name: "From Idea to Shipped in 3 Days"
- URL: ${LANDING_PAGE}
- Description: A practical guide for non-developers and entrepreneurs who want to build and launch a digital product using Claude Code and AI, without knowing how to code.
- Ideal customer: entrepreneur, creator, freelancer, or professional with an idea who doesn't know how to execute it technically.

MUST-HAVE CRITERIA (post must match ALL 3):
1. Author is clearly non-technical, has no dev background, or is struggling to use Claude/AI coding tools effectively
2. Post shows a real builder pain: context blowing up, token limits, Claude Code cost, debugging, Claude app vs Claude Code confusion, prompting/spec workflow, or shipping an MVP
3. Post is asking for help, sharing a painful lesson, or inviting practical advice where a useful workflow comment fits naturally

BONUS CRITERIA (prioritize posts matching these):
- Explicitly mentions "no code", "without coding", or inability to code technically
- Mentions Claude Code, Cursor, Copilot, or other AI coding tools
- Frustrated tone about technical limitations blocking their execution
- Urgency signals: "ship fast", "launch soon", "side project", "startup idea"
- The thread is early enough that a useful comment can still be seen
- The post asks for a concrete workflow, debugging, prompting, shipping, validation, or first-product advice
- Prefer r/ClaudeCode and r/vibecoding when the thread is specifically about Claude Code workflow, token/context limits, debugging, specs, or shipping with AI
- Proven winning topics: Claude Code too expensive, context/token usage, Claude app vs Claude Code, debugging precisely, no dev background, how people get the most out of Claude

DISQUALIFY IF:
- Post is from a developer/technical builder (even if interested in AI tools)
- Post is only casually discussing AI or technology news
- Post is low-effort ("help" or no clear question)
- Post is older than 7 days
- Already has multiple highly-upvoted expert answers
- Strongly negative tone toward AI
- OP is complaining about a tool not working or asking for specific no-code tool recommendations instead of asking how to build/launch
- OP is comparing tools or asking "what's better: X or Y tool" - these are not our posts
- The only possible reply would be a vague encouragement or a generic "I wrote this down" link drop
- The post is mainly a showcase, meme, AI image, "my latest game", or hype post and does not ask for feedback, advice, users, or next steps

PROVEN COMMENT STYLE:
- Write like a real non-dev builder replying from experience, not like a marketer.
- The best comments are short and follow exactly: one useful insight, one personal/context sentence if natural, casual link last.
- Good openings: "what helped me was...", "same boat, no dev background...", "the real unlock was...", "for your use case...", "i use sonnet for..."
- Good link closers: "happy to share what worked for me -> [more info here](${LANDING_PAGE})", "made a small guide on this: [claude guide](${LANDING_PAGE})", "put the workflow here: [more info](${LANDING_PAGE})"
- Only use first person when it fits the post. Never invent a dramatic story or claim results beyond the product's real angle.
- Target structure examples:
  "what helped me was X. it fixed Y.\n\nhappy to share what worked for me -> [more info here](${LANDING_PAGE})"
  "same boat, no dev background. biggest fix was X.\n\nmade a small guide on this: [claude guide](${LANDING_PAGE})"

STRICT FILTERING:
- If a post only PARTIALLY matches must-have criteria, DISCARD IT
- If you find fewer than 5 genuinely excellent posts, return only those few (do NOT pad with weak matches)
- Better to return 2 perfect posts than 8 mediocre ones
- Prefer one high-fit, high-specificity comment over four generic comments

OUTPUT FORMAT (MANDATORY):
Return ONLY a JSON array. No markdown, no explanations, no extra text before or after. All fields are required.

[
  {
    "reddit_url": "https://reddit.com/r/...",
    "title": "exact post title",
    "reason": "1-2 sentences explaining why this post is an excellent fit (be specific about which criteria it matches)",
    "reply": "Write a short Reddit-native comment. Rules: (1) Maximum 55 words total. (2) Use 1-2 short paragraphs. (3) Structure: one useful insight/tactic, then one personal/context sentence if natural, then a casual link. (4) Start with phrases like 'what helped me was', 'same boat', 'the real unlock was', or 'for your use case' when they fit. (5) No generic marketing phrases like 'structured workflow helps', 'step-by-step process', 'for non-coders', or 'shippable product'. (6) No exclamation marks. (7) Use Reddit Markdown for the link, e.g. '[more info here](${LANDING_PAGE})' or '[claude guide](${LANDING_PAGE})'. Do not paste raw URL. (8) It should sound like Jaumee sharing what worked, not a brand account.",
    "risk": "none | sensitive | saturated | other"
  }
]`;

const els = {
  scanButton: document.querySelector("#scanButton"),
  statusText: document.querySelector("#statusText"),
  cacheStatus: document.querySelector("#cacheStatus"),
  results: document.querySelector("#results"),
  emptyState: document.querySelector("#emptyState"),
  errorState: document.querySelector("#errorState"),
  errorMessage: document.querySelector("#errorMessage"),
  cardTemplate: document.querySelector("#cardTemplate"),
  autopostToggle: document.querySelector("#autopostToggle"),
  autopostLabel: document.querySelector("#autopostLabel"),
  autopostMeta: document.querySelector("#autopostMeta"),
  dashboardStatus: document.querySelector("#dashboardStatus"),
  runQueueButton: document.querySelector("#runQueueButton"),
  clearQueueButton: document.querySelector("#clearQueueButton"),
  queueCount: document.querySelector("#queueCount"),
  logCount: document.querySelector("#logCount"),
  viewsGeneratedValue: document.querySelector("#viewsGeneratedValue"),
  postedTodayValue: document.querySelector("#postedTodayValue"),
  successRateValue: document.querySelector("#successRateValue"),
  nextPostCountdownValue: document.querySelector("#nextPostCountdownValue"),
  nextPostMeta: document.querySelector("#nextPostMeta"),
  activityTableBody: document.querySelector("#activityTableBody"),
  activityTableContainer: document.querySelector("#activityTableBody")?.closest(".feed-container"),
  activityRowTemplate: document.querySelector("#activityRowTemplate"),
};

let dashboardRefreshTimer = null;
let autopostTimer = null;
let countdownTimer = null;
let nextAutopostAt = null;
let nextQueuePostAt = null;

init();

function init() {
  setupActivityTableScroll();
  setupDashboardEffects();
  els.scanButton.addEventListener("click", scanReddit);
  els.runQueueButton.addEventListener("click", runQueueNow);
  els.clearQueueButton.addEventListener("click", clearPendingQueue);
  els.autopostToggle.addEventListener("change", handleAutopostToggle);

  const autopostEnabled = localStorage.getItem(AUTOPOST_STORAGE) === "true";
  els.autopostToggle.checked = autopostEnabled;
  updateAutopostUI();
  refreshDashboard();
  scheduleDashboardRefresh();
  scheduleCountdownRefresh();

  if (autopostEnabled) {
    scheduleAutopost();
  }
}

function setupActivityTableScroll() {
  if (!els.activityTableContainer) {
    return;
  }

  els.activityTableContainer.style.maxHeight = "400px";
  els.activityTableContainer.style.overflowY = "auto";
}

function setupDashboardEffects() {
  const bg = document.getElementById("bg-effects");
  const cardsContainer = document.getElementById("cards-container");

  if (bg && !bg.childElementCount) {
    for (let i = 0; i < 150; i += 1) {
      const star = document.createElement("div");
      star.className = "star";
      const size = Math.random() * 2 + 0.5;
      star.style.width = `${size}px`;
      star.style.height = `${size}px`;
      star.style.left = `${Math.random() * 100}%`;
      star.style.top = `${Math.random() * 100}%`;
      star.style.setProperty("--t", `${Math.random() * 15 + 10}s`);
      star.style.setProperty("--dx", `${(Math.random() - 0.5) * 100}px`);
      star.style.setProperty("--dy", `${(Math.random() - 0.5) * 100}px`);
      star.style.setProperty("--max-o", `${Math.random() * 0.7 + 0.3}`);
      star.style.animationDelay = `${Math.random() * -20}s`;
      bg.appendChild(star);
    }
  }

  if (cardsContainer) {
    cardsContainer.addEventListener("mousemove", (event) => {
      for (const card of document.getElementsByClassName("card")) {
        const rect = card.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        card.style.setProperty("--mouse-x", `${x}px`);
        card.style.setProperty("--mouse-y", `${y}px`);
      }
    });
  }
}

async function scanReddit() {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    showError(
      "Gemini API key missing. Set it once in DevTools with: localStorage.setItem('redditauth.geminiApiKey', 'YOUR_KEY')"
    );
    return;
  }

  setLoading(true);
  hideMessages();
  els.results.innerHTML = "";

  try {
    const posts = await fetchRecentRedditPosts();
    if (!posts.length) {
      renderResults([]);
      showEmpty();
      return;
    }

    const shortlistedPosts = shortlistPosts(posts);
    updateStatus(
      `Scoring ${shortlistedPosts.length} shortlisted posts and finding the best matches...`
    );
    const opportunities = await analyzeWithGemini(shortlistedPosts, apiKey);
    const normalized = normalizeOpportunities(opportunities);

    if (normalized.length > 10) {
      updateStatus(`Found ${normalized.length} matches, but limiting to top 10.`);
      normalized.length = 10;
    }

    localStorage.setItem(RESULTS_STORAGE, JSON.stringify(normalized));
    renderResults(normalized);

    if (!normalized.length) {
      showEmpty();
    }
  } catch (error) {
    showError(error.message || "Something went wrong while scanning Reddit.");
  } finally {
    setLoading(false);
  }
}

function shortlistPosts(posts) {
  const keywords = [
    "no code",
    "nocode",
    "without coding",
    "don't know how to code",
    "non technical",
    "non-technical",
    "build app",
    "build an app",
    "app idea",
    "launch",
    "side project",
    "startup idea",
    "ship",
    "ai to build",
    "claude",
    "claude code",
    "cursor",
    "copilot",
    "developer",
    "technical cofounder",
    "token limit",
    "context",
    "debugging",
    "prompting",
    "spec",
    "workflow",
  ];

  return posts
    .map((post) => {
      const text = `${post.title} ${post.selftext}`.toLowerCase();
      const keywordScore = keywords.reduce(
        (score, keyword) => score + (text.includes(keyword) ? 8 : 0),
        0
      );
      const engagementScore = Math.min(post.comments, 25) + Math.min(post.score, 40) / 4;
      const subredditScore = ["claudecode", "vibecoding"].includes(String(post.subreddit).toLowerCase()) ? 18 : 0;
      const lowFitPenalty = /\b(showcase|built a|launched|roast my|look what i made)\b/i.test(text) ? 12 : 0;
      return { ...post, local_score: keywordScore + engagementScore + subredditScore - lowFitPenalty };
    })
    .sort((a, b) => b.local_score - a.local_score)
    .slice(0, 35);
}

function getGeminiApiKey() {
  return localStorage.getItem(API_KEY_STORAGE) || "";
}

async function fetchRecentRedditPosts() {
  const scanCount = Number(localStorage.getItem(SCAN_COUNT_STORAGE) || "0");
  localStorage.setItem(SCAN_COUNT_STORAGE, String(scanCount + 1));

  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const posts = [];
  const seen = new Set();

  for (let index = 0; index < SUBREDDITS.length; index += 1) {
    const subreddit = SUBREDDITS[index];
    if (BLOCKED_SUBREDDITS.has(subreddit.toLowerCase())) {
      updateStatus(`Skipping blocked subreddit r/${subreddit}...`);
      continue;
    }

    const query = SEARCH_QUERIES[(scanCount + index) % SEARCH_QUERIES.length];
    updateStatus(`Fetching r/${subreddit} for "${query}"...`);

    const listing = await fetchSubredditSearch(subreddit, query);
    for (const child of listing.data?.children || []) {
      const post = child.data;
      const createdMs = (post.created_utc || 0) * 1000;
      const url = post.permalink ? `https://reddit.com${post.permalink}` : post.url;

      if (!url || seen.has(post.id) || createdMs < cutoff) continue;
      seen.add(post.id);
      posts.push({
        id: post.id,
        subreddit: post.subreddit,
        title: post.title || "",
        url,
        selftext: (post.selftext || "").slice(0, 1800),
        score: post.score || 0,
        comments: post.num_comments || 0,
        created_utc: post.created_utc,
      });
    }

    if (index < SUBREDDITS.length - 1) {
      await delay(1000);
    }
  }

  return posts;
}

async function fetchSubredditSearch(subreddit, query) {
  const url = `/api/reddit?subreddit=${encodeURIComponent(subreddit)}&query=${encodeURIComponent(
    query
  )}`;

  const response = await fetchRedditUrl(url);

  if (response.status === 429) {
    updateStatus(`Rate limited by r/${subreddit}. Retrying once in 2 seconds...`);
    await delay(2000);
    const retry = await fetchRedditUrl(url);
    if (!retry.ok) {
      throw new Error(`Reddit retry failed for r/${subreddit}: ${retry.status}`);
    }
    return retry.json();
  }

  if (!response.ok) {
    throw new Error(`Reddit fetch failed for r/${subreddit}: ${response.status}`);
  }

  return response.json();
}

async function fetchRedditUrl(url) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    return await fetch(url, { signal: controller.signal });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`Request timed out after ${FETCH_TIMEOUT_MS / 1000}s for ${url}`);
    }
    throw new Error(`Network request failed for ${url}: ${error.message}`);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function analyzeWithGemini(posts, apiKey) {
  let lastError;

  for (const model of GEMINI_MODELS) {
    updateStatus(`Scoring ${posts.length} shortlisted posts with ${model}...`);
    try {
      return await callGeminiModel(posts, apiKey, model);
    } catch (error) {
      lastError = error;
      if (!error.retryable) throw error;
      updateStatus(`${model} is busy. Trying fallback model...`);
      await delay(800);
    }
  }

  throw lastError || new Error("Gemini analysis failed.");
}

async function callGeminiModel(posts, apiKey, model) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const response = await fetch(`${endpoint}?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `${SYSTEM_PROMPT}

CRITICAL: Analyze these Reddit posts and identify ONLY the BEST 5-10 matches.
- If fewer than 5 are genuinely excellent, return fewer.
- Do NOT pad with weak matches.
- Ensure each post meets ALL three must-have criteria.
- Return VALID JSON ONLY. No explanations.

Posts to analyze:
${JSON.stringify(posts, null, 2)}`,
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.3,
        responseMimeType: "application/json",
      },
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    if (response.status === 429) {
      throw new Error(
        "Gemini quota exceeded for the configured API key. The Reddit scan worked, but Gemini refused the analysis request. Try again later or use a key with available quota."
      );
    }
    if (response.status === 403 && /reported as leaked|PERMISSION_DENIED/i.test(detail)) {
      throw new Error(
        "Gemini API key was rejected as leaked. Create a new key and set it with: localStorage.setItem('redditauth.geminiApiKey', 'YOUR_NEW_KEY')"
      );
    }
    const error = new Error(
      `Gemini request failed on ${model}: ${response.status}. ${detail.slice(0, 220)}`
    );
    error.retryable = response.status === 503 || response.status === 500;
    throw error;
  }

  const data = await response.json();
  const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) {
    throw new Error("Gemini returned an empty response.");
  }

  return JSON.parse(stripMarkdownFence(rawText));
}

function stripMarkdownFence(text) {
  return text
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
}

function normalizeOpportunities(opportunities) {
  if (!Array.isArray(opportunities)) return [];

  return opportunities
    .filter((item) => item && (item.reddit_url || item.url) && item.title)
    .map((item) => ({
      reddit_url: String(item.reddit_url || item.url || ""),
      title: String(item.title),
      reason: String(item.reason || item.opportunity || "Relevant opportunity."),
      reply: String(item.reply || item.suggested_reply || item.value_comment || ""),
      risk: normalizeRisk(item.risk),
    }));
}

function normalizeRisk(risk) {
  const normalized = String(risk || "none").toLowerCase().trim();
  if (normalized.includes("sensitive")) return "sensitive subreddit";
  if (normalized.includes("saturated")) return "saturated";
  if (normalized.includes("other")) return "other";
  return "none";
}

function parseMarkdownLinks(text) {
  return text.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer" class="inline-link">$1</a>'
  );
}

function renderResults(results) {
  hideMessages();
  els.results.innerHTML = "";
  els.cacheStatus.textContent = results.length
    ? `${results.length} opportunities found`
    : "No cached opportunities";

  for (const result of results) {
    const card = els.cardTemplate.content.firstElementChild.cloneNode(true);
    const title = card.querySelector(".post-title");
    const redditLink = card.querySelector(".reddit-link");
    const riskPill = card.querySelector(".risk-pill");

    title.href = result.reddit_url;
    title.textContent = result.title;

    if (redditLink) {
      redditLink.href = result.reddit_url;
      redditLink.textContent = "View on Reddit ->";
    }

    card.querySelector(".reason").textContent = result.reason;

    const replyEl = card.querySelector(".reply");
    replyEl.innerHTML = parseMarkdownLinks(result.reply);

    riskPill.classList.add(`risk-${riskClass(result.risk)}`);
    card.querySelector(".risk-label").textContent = result.risk;

    const copyButton = card.querySelector(".copy-button");
    copyButton.addEventListener("click", () => copyText(result.reply, copyButton));

    els.results.append(card);
  }
}

async function copyText(text, button) {
  try {
    if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
    await navigator.clipboard.writeText(text);
  } catch {
    fallbackCopyText(text);
  }
  const original = button.textContent;
  button.textContent = "Copied!";
  button.disabled = true;
  setTimeout(() => {
    button.textContent = original;
    button.disabled = false;
  }, 2000);
}

function fallbackCopyText(text) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.append(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function riskClass(risk) {
  if (risk === "sensitive subreddit") return "sensitive";
  if (risk === "saturated") return "saturated";
  if (risk === "other") return "other";
  return "none";
}

function setLoading(isLoading) {
  els.scanButton.disabled = isLoading;
  els.scanButton.classList.toggle("is-loading", isLoading);
  if (!isLoading) {
    updateStatus("");
  }
}

function updateStatus(message) {
  els.statusText.textContent = message;
}

function updateDashboardStatus(message) {
  els.dashboardStatus.textContent = message;
}

function updateAutopostUI() {
  const enabled = els.autopostToggle.checked;
  els.autopostLabel.textContent = enabled ? "On" : "Off";

  if (!enabled) {
    els.autopostMeta.textContent = "Queue paused. Nothing will post automatically.";
    return;
  }

  if (nextAutopostAt) {
    els.autopostMeta.textContent = `Autopost active. Next run scheduled for ${formatDateTime(nextAutopostAt)}.`;
    return;
  }

  els.autopostMeta.textContent = "Autopost active. Next run time is being scheduled.";
}

function scheduleDashboardRefresh() {
  clearInterval(dashboardRefreshTimer);
  dashboardRefreshTimer = setInterval(refreshDashboard, DASHBOARD_REFRESH_MS);
}

function scheduleCountdownRefresh() {
  clearInterval(countdownTimer);
  countdownTimer = setInterval(() => updateNextPostCountdown(), 1000);
}

function handleAutopostToggle() {
  localStorage.setItem(AUTOPOST_STORAGE, String(els.autopostToggle.checked));
  if (els.autopostToggle.checked) {
    scheduleAutopost();
  } else {
    clearTimeout(autopostTimer);
    autopostTimer = null;
    nextAutopostAt = null;
  }
  updateAutopostUI();
}

function getNextAutopostTime(from = new Date()) {
  const next = new Date(from);
  next.setHours(AUTOPOST_HOUR_LOCAL, 0, 0, 0);

  if (next <= from) {
    next.setDate(next.getDate() + 1);
    next.setHours(AUTOPOST_HOUR_LOCAL, 0, 0, 0);
  }

  return next;
}

function scheduleAutopost() {
  clearTimeout(autopostTimer);
  nextAutopostAt = getNextAutopostTime();
  updateAutopostUI();

  const delayMs = nextAutopostAt.getTime() - Date.now();
  autopostTimer = setTimeout(async () => {
    if (!els.autopostToggle.checked) return;
    await runQueueNow(true);
    if (els.autopostToggle.checked) {
      scheduleAutopost();
    }
  }, Math.max(delayMs, 1000));
}

async function refreshDashboard() {
  try {
    const response = await fetch("/api/queue");
    if (!response.ok) {
      throw new Error(`Queue request failed: ${response.status}`);
    }
    const queue = await response.json();
    renderDashboard(queue);
  } catch (error) {
    updateDashboardStatus(error.message || "Could not load queue status.");
  }
}

function normalizeQueuePostUrl(postUrl) {
  try {
    const url = new URL(String(postUrl));
    url.hostname = url.hostname.replace(/^(www\.|old\.)/i, "").toLowerCase();
    url.hash = "";
    url.search = "";

    const parts = url.pathname.split("/").filter(Boolean);
    const subredditIndex = parts.findIndex((part) => part.toLowerCase() === "r");
    const commentsIndex = parts.findIndex((part) => part.toLowerCase() === "comments");
    const postId = commentsIndex >= 0 ? parts[commentsIndex + 1] : null;

    if (postId && /^[a-z0-9]+$/i.test(postId)) {
      if (subredditIndex >= 0 && parts[subredditIndex + 1]) {
        return `https://reddit.com/r/${parts[subredditIndex + 1].toLowerCase()}/comments/${postId.toLowerCase()}`;
      }

      return `https://reddit.com/comments/${postId.toLowerCase()}`;
    }

    return url.toString().replace(/\/$/, "");
  } catch {
    const value = String(postUrl || "").trim().replace(/\/$/, "");
    const match = value.match(/\/r\/([^/]+)\/comments\/([a-z0-9]+)/i);
    return match ? `https://reddit.com/r/${match[1].toLowerCase()}/comments/${match[2].toLowerCase()}` : value;
  }
}

function queueItemDisplayRank(item) {
  if (item?.status === "posted") return 3;
  if (item?.status === "pending") return 2;
  if (item?.status === "failed") return 1;
  return 0;
}

function shouldReplaceQueueDisplayItem(existing, candidate) {
  const existingRank = queueItemDisplayRank(existing);
  const candidateRank = queueItemDisplayRank(candidate);
  if (candidateRank !== existingRank) return candidateRank > existingRank;

  const existingTime = new Date(existing?.postedAt || existing?.scheduledAt || 0).getTime();
  const candidateTime = new Date(candidate?.postedAt || candidate?.scheduledAt || 0).getTime();
  if (!Number.isFinite(existingTime)) return true;
  if (!Number.isFinite(candidateTime)) return false;

  return candidateRank === 2 ? candidateTime < existingTime : candidateTime > existingTime;
}

function dedupeQueueItems(queue) {
  const knownItems = new Map();
  const uniqueItems = [];

  for (const item of Array.isArray(queue) ? queue : []) {
    const key = normalizeQueuePostUrl(item?.postUrl);
    if (!key) {
      uniqueItems.push(item);
      continue;
    }

    const knownIndex = knownItems.get(key);
    if (knownIndex === undefined) {
      knownItems.set(key, uniqueItems.length);
      uniqueItems.push(item);
      continue;
    }

    if (shouldReplaceQueueDisplayItem(uniqueItems[knownIndex], item)) {
      uniqueItems[knownIndex] = item;
    }
  }

  return uniqueItems;
}

function renderDashboard(queue) {
  const items = dedupeQueueItems(queue);
  const postedItems = items.filter((item) => item.status === "posted");
  const failedItems = items.filter((item) => item.status === "failed");
  const pendingItems = items.filter((item) => item.status === "pending");
  const postedToday = postedItems.filter((item) => isToday(item.postedAt)).length;
  const resolvedCount = postedItems.length + failedItems.length;
  const successRate = resolvedCount ? Math.round((postedItems.length / resolvedCount) * 100) : 0;

  nextQueuePostAt = [...pendingItems].sort(
    (a, b) => new Date(a.scheduledAt || 0).getTime() - new Date(b.scheduledAt || 0).getTime()
  )[0]?.scheduledAt || null;

  els.viewsGeneratedValue.textContent = String(postedItems.length);
  els.postedTodayValue.textContent = `${postedToday}/4`;
  els.successRateValue.textContent = `${successRate}%`;
  els.queueCount.textContent = `${pendingItems.length} queued`;
  els.logCount.textContent = `${postedToday} today`;
  els.nextPostMeta.textContent = nextQueuePostAt
    ? `Scheduled for ${formatDateTime(nextQueuePostAt)}`
    : "No pending post scheduled.";

  updateNextPostCountdown();
  renderActivityTable(items);
}

function renderActivityTable(items) {
  els.activityTableBody.innerHTML = "";

  if (!items.length) {
    els.activityTableBody.innerHTML =
      '<tr><td colspan="4"><p class="dashboard-empty">No queue activity yet.</p></td></tr>';
    return;
  }

  const sorted = [...items].sort((a, b) => {
    const aTime = new Date(a.postedAt || a.scheduledAt || 0).getTime();
    const bTime = new Date(b.postedAt || b.scheduledAt || 0).getTime();
    return bTime - aTime;
  });

  for (const item of sorted) {
    const row = els.activityRowTemplate.content.firstElementChild.cloneNode(true);
    row.querySelector(".activity-time").textContent = formatTime(item.postedAt || item.scheduledAt);
    row.querySelector(".activity-subreddit").textContent = `r/${item.subreddit || "unknown"}`;
    row.querySelector(".activity-title").textContent = buildQueueTitle(item);
    row.querySelector(".activity-preview").textContent = String(item.commentText || item.postUrl || "").slice(0, 100);

    const badge = row.querySelector(".activity-status-badge");
    const mapped = mapStatusForBadge(item.status);
    badge.textContent = mapped.label;
    badge.classList.add(`status-${mapped.className}`);

    els.activityTableBody.append(row);
  }
}

async function runQueueNow(triggeredByAutopost = false) {
  const button = els.runQueueButton;
  button.disabled = true;
  button.classList.add("is-loading");
  updateDashboardStatus(
    triggeredByAutopost ? "Autopost triggered the daily queue job..." : "Starting the daily queue job..."
  );

  try {
    const response = await fetch("/api/queue/run", { method: "POST" });
    const payload = await response.json();

    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || `Queue run failed with status ${response.status}`);
    }

    updateDashboardStatus("Queue job started. Refreshing queue status...");
    setTimeout(refreshDashboard, 1500);
  } catch (error) {
    updateDashboardStatus(error.message || "Could not start the queue job.");
  } finally {
    button.disabled = false;
    button.classList.remove("is-loading");
  }
}

async function clearPendingQueue() {
  els.clearQueueButton.disabled = true;
  updateDashboardStatus("Clearing pending queue items...");

  try {
    const response = await fetch("/api/queue/clear", { method: "POST" });
    const payload = await response.json();

    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || `Queue clear failed with status ${response.status}`);
    }

    updateDashboardStatus(`Cleared ${payload.cleared || 0} pending items.`);
    await refreshDashboard();
  } catch (error) {
    updateDashboardStatus(error.message || "Could not clear the queue.");
  } finally {
    els.clearQueueButton.disabled = false;
  }
}

function showError(message) {
  els.emptyState.hidden = true;
  els.errorState.hidden = false;
  els.errorMessage.textContent = message;
}

function showEmpty() {
  els.errorState.hidden = true;
  els.emptyState.hidden = false;
}

function hideMessages() {
  els.errorState.hidden = true;
  els.emptyState.hidden = true;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildQueueTitle(item) {
  return item.title || item.postUrl || "Queued Reddit post";
}

function isToday(value) {
  if (!value) return false;
  const date = new Date(value);
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

function formatDateTime(value) {
  if (!value) return "Unscheduled";
  return new Date(value).toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatTime(value) {
  if (!value) return "Unknown time";
  return new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function updateNextPostCountdown() {
  if (!nextQueuePostAt) {
    els.nextPostCountdownValue.textContent = "--:--:--";
    return;
  }

  const remainingMs = new Date(nextQueuePostAt).getTime() - Date.now();
  if (remainingMs <= 0) {
    els.nextPostCountdownValue.textContent = "00:00:00";
    els.nextPostMeta.textContent = "Due now. Waiting for the queue processor.";
    return;
  }

  els.nextPostCountdownValue.textContent = formatCountdown(remainingMs);
}

function formatCountdown(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
}

function mapStatusForBadge(status) {
  if (status === "failed") {
    return { label: "FAILED", className: "failed" };
  }
  if (status === "posted") {
    return { label: "POSTED", className: "posted" };
  }
  if (status === "pending") {
    return { label: "PENDING", className: "pending" };
  }
  return { label: "SUCCESS", className: "success" };
}
