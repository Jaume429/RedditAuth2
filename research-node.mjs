import { HttpsProxyAgent } from 'https-proxy-agent';
import { request as httpsRequest } from 'node:https';

const SUBREDDITS = [
  "SideProject",
  "nocode",
  "Entrepreneur",
  "artificial",
  "ChatGPT",
  "indiehackers",
  "ClaudeCode",
  "vibecoding",
  "ClaudeAI",
];

const BLOCKED_SUBREDDITS = new Set([
  "startups",
]);

const SEARCH_QUERIES = [
  "don't know how to code",
  "can't code",
  "non-technical founder",
  "I have an idea",
  "technical barrier",
  "build without coding",
  "execution problem",
  "product idea but",
  "no programming skills",
  "how to build app",
  "startup as non-developer",
  "coding knowledge",
];

const SUBREDDIT_QUERY_PACKS = {
  claudecode: [
    "coding amateur",
    "built with Claude",
    "Claude Code app",
    "first project",
    "I built",
    "MVP",
  ],
  claudeai: [
    "built with Claude",
    "Claude app",
    "workflow",
    "non technical",
    "I built",
  ],
  vibecoding: [
    "vibe coding",
    "built an app",
    "first app",
    "product idea",
    "can't code",
  ],
  sideproject: [
    "MVP",
    "product idea",
    "launched",
    "build app",
    "non technical",
  ],
  nocode: [
    "can't code",
    "build without coding",
    "non technical founder",
    "no code app",
    "technical cofounder",
  ],
  indiehackers: [
    "MVP",
    "product idea",
    "technical cofounder",
    "build app",
  ],
  entrepreneur: [
    "non technical founder",
    "technical cofounder",
    "I have an idea",
    "MVP",
  ],
  chatgpt: [
    "build app",
    "product idea",
    "can't code",
  ],
  artificial: [
    "build app",
    "technical barrier",
    "product idea",
  ],
};

const SUBREDDIT_QUERY_BUDGETS = {
  claudecode: 5,
  claudeai: 5,
  vibecoding: 4,
  sideproject: 4,
  nocode: 3,
  indiehackers: 3,
  entrepreneur: 2,
  chatgpt: 2,
  artificial: 2,
};

const HIGH_PRIORITY_SUBREDDITS = new Set(["claudecode", "claudeai", "vibecoding", "sideproject"]);

const LANDING_PAGE = "https://buildwithclaude.vercel.app";

const SYSTEM_PROMPT = `You are a Reddit-native operator finding ONLY the most relevant reply opportunities for a specific digital product. Your job is strict filtering and writing useful comments that sound like they belong in the thread.

PRODUCT:
- Name: "From Idea to Shipped in 3 Days"
- URL: ${LANDING_PAGE}
- Description: A practical guide for non-developers and entrepreneurs who want to build and launch a digital product using Claude Code and AI, without knowing how to code.
- Ideal customer: entrepreneur, creator, freelancer, or professional with an idea who doesn't know how to execute it technically.

MUST-HAVE CRITERIA (post must match AT LEAST 2 of 3):
1. Author explicitly says they can't code, don't know how to code, or is non-technical - OR they're an entrepreneur/maker with a real idea and execution barrier
2. Post shows CONCRETE INTENT to BUILD or LAUNCH a real product/project (not theoretical, not tool shopping)
3. Post is asking for HELP/ADVICE with how to overcome technical barrier or execute their idea

BONUS CRITERIA (prioritize posts matching these):
- Author explicitly says "I don't know how to code" or "I can't code"
- Author is entrepreneur, maker, founder, or freelancer
- They describe a specific product/business idea they want to build
- Frustrated tone about technical skills being the blocker
- Asking "how do I..." or "is there a way to..." build without coding

DISQUALIFY IF:
- Author explicitly identifies as a developer, software engineer, or has professional coding experience
- Post is ONLY asking for tool comparisons ("Claude vs Cursor vs ChatGPT")
- Post is casual tech discussion with no personal project (just debating AI)
- Post is low-effort, no clear question
- Post is older than 24 hours
- Already has 10+ highly-upvoted expert answers
- Problem is 100% non-technical (pure marketing/sales/fundraising/time management)
- Post is asking to learn programming as a skill (we're for building, not learning)

STRICT FILTERING:
- If a post doesn't clearly match at least 2 of 3 must-haves, DISCARD IT
- If you find fewer than 3 genuinely good posts, return only those (don't pad with weak matches)
- Better to return 2 perfect posts than 4 mediocre ones

OUTPUT FORMAT (MANDATORY):
Return ONLY a JSON array. No markdown, no explanations, no extra text before or after. All fields are required.

[
  {
    "reddit_url": "https://reddit.com/r/...",
    "title": "exact post title",
    "reason": "1-2 sentences explaining why this post is an excellent fit (be specific about which criteria it matches)",
    "reply": "Write a Reddit-native comment that would still be useful if the link were removed. Rules: (1) Answer the exact question/pain point in the post. (2) 1-2 short paragraphs, maximum 65 words total. (3) Start with the useful insight, not empathy filler. (4) Include one concrete tactic, example, or decision rule. (5) Use lowercase/casual style. (6) No exclamation marks. (7) Do NOT use these phrases: 'I wrote this down', 'if helpful', 'if it helps', 'I put together', 'guide', 'check it out', 'here is what I learned'. (8) Do not claim personal experience unless it naturally matches the post. (9) Add the link only as a soft afterthought in the final sentence using Reddit Markdown '[more here](${LANDING_PAGE})' or '[this is the workflow](${LANDING_PAGE})'. Do not paste raw URL. (10) Never make the link sentence longer than the useful advice.",
    "risk": "none | sensitive | saturated | other"
  }
]`;

const PROXY_URLS = [
  'http://aaubcdkxstaticresidential:ecljgj60smyr@136.0.170.174:6177',
  'http://aaubcdkxstaticresidential:ecljgj60smyr@45.56.179.101:9305',
  'http://aaubcdkxstaticresidential:ecljgj60smyr@136.0.170.174:6177',
  'http://aaubcdkxstaticresidential:ecljgj60smyr@45.56.179.101:9305',
  'http://aaubcdkxstaticresidential:ecljgj60smyr@136.0.170.174:6177',
  'http://aaubcdkxstaticresidential:ecljgj60smyr@45.56.179.101:9305',
  'http://aaubcdkxstaticresidential:ecljgj60smyr@136.0.170.174:6177',
  'http://aaubcdkxstaticresidential:ecljgj60smyr@45.56.179.101:9305',
  'http://aaubcdkxstaticresidential:ecljgj60smyr@136.0.170.174:6177',
  'http://aaubcdkxstaticresidential:ecljgj60smyr@45.56.179.101:9305',
];
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const MAX_POST_AGE_MS = 24 * 60 * 60 * 1000;
const REDDIT_TOP_TIME_RANGE = "week";
const MAX_PROXY_ATTEMPTS = 10;
const PROXY_RETRY_DELAY_MS = 3000;
const DATACENTER_IP_PREFIXES = ['34.', '35.', '52.', '54.', '18.', '3.', '44.'];
let activeProxyUrl = PROXY_URLS[0];

class ProxyUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = "ProxyUnavailableError";
  }
}

class RedditRateLimitedError extends Error {
  constructor(message) {
    super(message);
    this.name = "RedditRateLimitedError";
  }
}

function log(message) {
  console.log(`[research-node] ${message}`);
}

function isProxyUnavailableStatus(status) {
  return status === 402 || status === 407;
}

function describeHttpStatus(status) {
  if (status === 402) return "HTTP 402 (proxy provider payment/credit issue)";
  if (status === 407) return "HTTP 407 (proxy authentication failed)";
  return `HTTP ${status}`;
}

function normalizePostUrl(postUrl) {
  try {
    const url = new URL(String(postUrl));
    url.protocol = 'https:';
    url.hostname = url.hostname.replace(/^(www\.|old\.)/i, '').toLowerCase();
    url.hash = '';
    url.search = '';
    url.pathname = url.pathname.replace(/\/$/, '');

    const parts = url.pathname.split('/').filter(Boolean);
    const subredditIndex = parts.findIndex((part) => part.toLowerCase() === 'r');
    const commentsIndex = parts.findIndex((part) => part.toLowerCase() === 'comments');
    const postId = commentsIndex >= 0 ? parts[commentsIndex + 1] : null;

    if (postId && /^[a-z0-9]+$/i.test(postId)) {
      if (subredditIndex >= 0 && parts[subredditIndex + 1]) {
        return `https://reddit.com/r/${parts[subredditIndex + 1].toLowerCase()}/comments/${postId.toLowerCase()}`;
      }

      return `https://reddit.com/comments/${postId.toLowerCase()}`;
    }

    return url.toString();
  } catch {
    const value = String(postUrl || '').trim().replace(/\/$/, '');
    const match = value.match(/\/r\/([^/]+)\/comments\/([a-z0-9]+)/i);
    if (match) {
      return `https://reddit.com/r/${match[1].toLowerCase()}/comments/${match[2].toLowerCase()}`;
    }
    return value;
  }
}

function buildKnownPostUrlSet(postUrls = []) {
  return new Set(postUrls.filter(Boolean).map(normalizePostUrl));
}

function extractSubredditFromUrl(postUrl) {
  const match = String(postUrl).match(/\/r\/([^/]+)/i);
  return match?.[1] || 'unknown';
}

function isBlockedSubreddit(subreddit) {
  return BLOCKED_SUBREDDITS.has(String(subreddit || '').toLowerCase());
}

function normalizeLearning(learning = {}) {
  return {
    topSubreddits: Array.isArray(learning?.topSubreddits) ? learning.topSubreddits : [],
    effectiveTerms: Array.isArray(learning?.effectiveTerms) ? learning.effectiveTerms : [],
    productiveHoursUtc: Array.isArray(learning?.productiveHoursUtc) ? learning.productiveHoursUtc : [],
    effectiveTones: Array.isArray(learning?.effectiveTones) ? learning.effectiveTones : [],
    searchQueries: Array.isArray(learning?.searchQueries) ? learning.searchQueries : [],
  };
}

function rankedSubredditsFromLearning(learning = {}) {
  const normalized = normalizeLearning(learning);
  const learnedNames = normalized.topSubreddits
    .map((item) => String(item.subreddit || '').trim())
    .filter(Boolean);
  const seen = new Set();
  const ranked = [...learnedNames, ...SUBREDDITS]
    .filter((subreddit) => {
      const key = subreddit.toLowerCase();
      if (seen.has(key) || isBlockedSubreddit(key)) return false;
      seen.add(key);
      return true;
    });

  return ranked;
}

function queryForIndex(index, learning = {}) {
  const normalized = normalizeLearning(learning);
  const learnedQueries = normalized.searchQueries
    .map((query) => String(query || '').trim())
    .filter((query) => query.length >= 4);
  const queries = [...learnedQueries, ...SEARCH_QUERIES];
  return queries[index % queries.length];
}

function uniqueStrings(values) {
  const seen = new Set();
  return values
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .filter((value) => {
      const key = value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function queryBudgetForSubreddit(subreddit) {
  const key = String(subreddit || '').toLowerCase();
  return SUBREDDIT_QUERY_BUDGETS[key] || 2;
}

function queryPackForSubreddit(subreddit, learning = {}, attempt = 1) {
  const key = String(subreddit || '').toLowerCase();
  const normalized = normalizeLearning(learning);
  const learnedQueries = normalized.searchQueries
    .map((query) => String(query || '').trim())
    .filter((query) => query.length >= 4);
  const baseQueries = SUBREDDIT_QUERY_PACKS[key] || [];
  const queries = uniqueStrings([...learnedQueries, ...baseQueries, ...SEARCH_QUERIES]);
  const budget = Math.min(queryBudgetForSubreddit(subreddit), queries.length);
  const start = ((attempt - 1) * budget) % Math.max(queries.length, 1);
  const selected = [];

  for (let offset = 0; selected.length < budget && offset < queries.length; offset += 1) {
    selected.push(queries[(start + offset) % queries.length]);
  }

  return selected.length ? selected : [queryForIndex(attempt - 1, learning)];
}

function chunkArray(values, size) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function buildCombinedQuery(queries) {
  return queries
    .map((query) => `"${String(query).replace(/"/g, '')}"`)
    .join(" OR ");
}

function oldRedditSearchUrl(subreddit, query, sort = "new", timeRange = "day") {
  const url = new URL(`https://old.reddit.com/r/${subreddit}/search`);
  url.searchParams.set("q", query);
  url.searchParams.set("restrict_sr", "on");
  url.searchParams.set("sort", sort);
  url.searchParams.set("t", timeRange);
  return url.toString();
}

function oldRedditListingUrl(subreddit, sort = "top_day") {
  const key = String(sort || "").toLowerCase();
  if (key === "hot") {
    return `https://old.reddit.com/r/${subreddit}/hot/`;
  }

  return `https://old.reddit.com/r/${subreddit}/top/?sort=top&t=day`;
}

function listingUrlsForSubreddit(subreddit) {
  const urls = [
    {
      label: "top_day",
      url: `https://www.reddit.com/r/${subreddit}/top.json?limit=35&t=day`,
      fallbackUrl: oldRedditListingUrl(subreddit, "top_day"),
    },
  ];

  if (HIGH_PRIORITY_SUBREDDITS.has(String(subreddit || '').toLowerCase())) {
    urls.push({
      label: "hot",
      url: `https://www.reddit.com/r/${subreddit}/hot.json?limit=25`,
      fallbackUrl: oldRedditListingUrl(subreddit, "hot"),
    });
  }

  return urls;
}

function learningSummaryForPrompt(learning = {}) {
  const normalized = normalizeLearning(learning);
  if (
    !normalized.topSubreddits.length &&
    !normalized.effectiveTerms.length &&
    !normalized.productiveHoursUtc.length &&
    !normalized.effectiveTones.length
  ) {
    return 'No historical performance data yet.';
  }

  return JSON.stringify({
    topSubreddits: normalized.topSubreddits.slice(0, 5),
    effectiveTerms: normalized.effectiveTerms.slice(0, 10),
    productiveHoursUtc: normalized.productiveHoursUtc.slice(0, 5),
    effectiveTones: normalized.effectiveTones.slice(0, 3),
  }, null, 2);
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function proxyLabel(proxyUrl) {
  const match = proxyUrl.match(/\/\/([^:]+):/);
  return match?.[1] || "unknown";
}

function nextProxyUrl(currentProxyUrl) {
  const currentIndex = PROXY_URLS.indexOf(currentProxyUrl);
  const nextIndex = (currentIndex + 1) % PROXY_URLS.length;
  return PROXY_URLS[nextIndex];
}

function fetchTextViaProxy(url, proxyUrl, options = {}) {
  return new Promise((resolve, reject) => {
    const request = httpsRequest(url, {
      method: "GET",
      headers: options.headers || {},
      agent: new HttpsProxyAgent(proxyUrl),
      timeout: options.timeout || 15000,
    }, (response) => {
      const chunks = [];

      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        resolve({
          ok: response.statusCode >= 200 && response.statusCode < 300,
          status: response.statusCode,
          text: async () => body,
          json: async () => JSON.parse(body),
        });
      });
    });

    request.on("timeout", () => {
      request.destroy(new Error(`Request timed out after ${options.timeout || 15000}ms`));
    });
    request.on("error", reject);
    request.end();
  });
}

function decodeHtmlEntities(value = "") {
  const named = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    "#39": "'",
    nbsp: " ",
  };

  return String(value).replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
    const key = entity.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(named, key)) {
      return named[key];
    }

    if (key.startsWith("#x")) {
      const codePoint = Number.parseInt(key.slice(2), 16);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }

    if (key.startsWith("#")) {
      const codePoint = Number.parseInt(key.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }

    return match;
  });
}

function textFromHtml(html = "") {
  return decodeHtmlEntities(
    String(html)
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function parseCommentCount(value = "") {
  if (/no comments?/i.test(value)) return 0;
  const match = String(value).replace(/,/g, "").match(/(\d+)/);
  return match ? Number(match[1]) : 0;
}

function parseOldRedditSearchPosts(html, subreddit, source = {}) {
  const posts = [];
  const chunks = String(html || "").split(/<div class=" search-result search-result-link/i).slice(1);

  for (const rawChunk of chunks) {
    const chunk = `<div class=" search-result search-result-link${rawChunk}`;
    const id = chunk.match(/data-fullname="t3_([a-z0-9]+)"/i)?.[1];
    const titleMatch = chunk.match(/<a[^>]+href="([^"]+)"[^>]*class="search-title[^"]*"[^>]*>([\s\S]*?)<\/a>/i);

    if (!id || !titleMatch) {
      continue;
    }

    const title = textFromHtml(titleMatch[2]);
    const href = decodeHtmlEntities(titleMatch[1]);
    const permalink = href.startsWith("http")
      ? new URL(href).pathname
      : href;
    const commentsText = chunk.match(/class="search-comments[^"]*"[^>]*>([\s\S]*?)<\/a>/i)?.[1] || "";
    const datetime = chunk.match(/<time[^>]+datetime="([^"]+)"/i)?.[1] || "";
    const bodyHtml = chunk.match(/<div class="search-result-body">\s*<div class="md">([\s\S]*?)<\/div>\s*<\/div>/i)?.[1] || "";
    const createdMs = Date.parse(datetime);
    const comments = parseCommentCount(textFromHtml(commentsText));

    posts.push({
      id,
      title,
      selftext: textFromHtml(bodyHtml),
      subreddit,
      permalink,
      url: `https://reddit.com${permalink}`,
      created_utc: Number.isFinite(createdMs) ? Math.floor(createdMs / 1000) : Math.floor(Date.now() / 1000),
      score: Math.max(5, comments),
      num_comments: comments,
      upvote_ratio: null,
      source_query: source.query || null,
      source_sort: source.sort || "old_search",
      source_subreddit: subreddit,
      source_scrape: "old_reddit_html",
    });
  }

  return posts;
}

function parseOldRedditListingPosts(html, subreddit, source = {}) {
  const posts = [];
  const thingPattern = /<div[^>]+class="[^"]*\bthing\b[^"]*"[^>]+data-fullname="t3_([a-z0-9]+)"[\s\S]*?(?=<div[^>]+class="[^"]*\bthing\b|<div class="nav-buttons"|<\/body>)/gi;
  let match;

  while ((match = thingPattern.exec(String(html || ""))) !== null) {
    const chunk = match[0];
    const id = match[1];
    const titleMatch = chunk.match(/<a[^>]+class="[^"]*\btitle\b[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);

    if (!titleMatch) {
      continue;
    }

    const title = textFromHtml(titleMatch[2]);
    const href = decodeHtmlEntities(titleMatch[1]);
    const permalink = chunk.match(/data-permalink="([^"]+)"/i)?.[1] ||
      (href.includes("/comments/") ? new URL(href, "https://old.reddit.com").pathname : `/r/${subreddit}/comments/${id}`);
    const commentsText = chunk.match(/<a[^>]+class="[^"]*\bcomments\b[^"]*"[^>]*>([\s\S]*?)<\/a>/i)?.[1] || "";
    const scoreText = chunk.match(/<div[^>]+class="[^"]*\bscore unvoted\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i)?.[1] || "";
    const datetime = chunk.match(/<time[^>]+datetime="([^"]+)"/i)?.[1] || "";
    const createdMs = Date.parse(datetime);
    const comments = parseCommentCount(textFromHtml(commentsText));
    const score = Number.parseInt(textFromHtml(scoreText).replace(/,/g, ""), 10);

    posts.push({
      id,
      title,
      selftext: "",
      subreddit,
      permalink,
      url: `https://reddit.com${permalink}`,
      created_utc: Number.isFinite(createdMs) ? Math.floor(createdMs / 1000) : Math.floor(Date.now() / 1000),
      score: Number.isFinite(score) ? score : Math.max(5, comments),
      num_comments: comments,
      upvote_ratio: null,
      source_query: source.query || null,
      source_sort: source.sort || "old_listing",
      source_subreddit: subreddit,
      source_scrape: "old_reddit_html",
    });
  }

  return posts;
}

function parseOldRedditPosts(html, subreddit, source = {}) {
  const searchPosts = parseOldRedditSearchPosts(html, subreddit, source);
  if (searchPosts.length) {
    return searchPosts;
  }

  return parseOldRedditListingPosts(html, subreddit, source);
}

async function fetchOldRedditFallback(target, subreddit) {
  if (!target.fallbackUrl) {
    return [];
  }

  const response = await fetchTextViaProxy(target.fallbackUrl, activeProxyUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      accept: 'text/html',
    },
    timeout: 15000
  });

  if (!response.ok) {
    if (response.status === 429) {
      throw new RedditRateLimitedError(`Old Reddit fallback rate limited for r/${subreddit}: 429`);
    }

    log(`Old Reddit fallback failed for r/${subreddit}: ${response.status}`);
    return [];
  }

  const html = await response.text();
  if (/You've been blocked by network security|Please wait for verification/i.test(html)) {
    log(`Old Reddit fallback for r/${subreddit} returned a Reddit verification/block page`);
    return [];
  }

  const parsed = parseOldRedditPosts(html, subreddit, target);
  if (parsed.length) {
    log(`Old Reddit fallback parsed ${parsed.length} post(s) for r/${subreddit} (${target.sort})`);
  }

  return parsed;
}

function isDatacenterIp(ip) {
  return DATACENTER_IP_PREFIXES.some((prefix) => ip.startsWith(prefix));
}

async function verifyProxyAttempt(proxyUrl) {
  try {
    log(`Verifying proxy connection via ${proxyLabel(proxyUrl)}...`);

    const response = await fetchTextViaProxy('https://ipv4.icanhazip.com', proxyUrl, {
      timeout: 10000
    });

    if (!response.ok) {
      log(`Proxy verification failed: ${describeHttpStatus(response.status)}`);
      return { ok: false, proxyUrl };
    }

    const text = await response.text();
    const ipMatch = text.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/);
    
    if (ipMatch) {
      const proxyIp = ipMatch[0];
      log(`Proxy is working. Detected IP: ${proxyIp}`);
      return { ok: true, ip: proxyIp, proxyUrl };
    } else {
      log("Proxy response received but could not parse IP");
      return { ok: false, proxyUrl };
    }
  } catch (error) {
    log(`Proxy verification failed: ${error.message}`);
    return { ok: false, proxyUrl };
  }
}

async function verifyProxyIsWorking() {
  let lastWorkingProxy = null;

  for (let attempt = 1; attempt <= MAX_PROXY_ATTEMPTS; attempt += 1) {
    const proxyUrl = PROXY_URLS[(attempt - 1) % PROXY_URLS.length];
    const verification = await verifyProxyAttempt(proxyUrl);

    if (verification.ok) {
      lastWorkingProxy = verification.proxyUrl;

      if (!isDatacenterIp(verification.ip)) {
        activeProxyUrl = verification.proxyUrl;
        log(`Residential proxy confirmed: ${verification.ip}`);
        return true;
      } else {
        log(`Detected datacenter IP ${verification.ip}. Retrying with another proxy...`);
      }
    }

    if (attempt < MAX_PROXY_ATTEMPTS) {
      await delay(PROXY_RETRY_DELAY_MS);
    }
  }

  if (lastWorkingProxy) {
    activeProxyUrl = lastWorkingProxy;
    log(`Warning: no residential IP found after ${MAX_PROXY_ATTEMPTS} attempts. Proceeding with last working proxy.`);
    return true;
  }

  log(`Warning: proxy verification failed after ${MAX_PROXY_ATTEMPTS} attempts.`);
  return false;
}

async function fetchRedditPosts(learning = {}, attempt = 1) {
  const posts = [];
  const seen = new Set();
  const subreddits = rankedSubredditsFromLearning(learning);

  const addPost = (post, now, source = {}) => {
    const createdMs = (post.created_utc || 0) * 1000;

    if (now - createdMs > MAX_POST_AGE_MS) {
      return false;
    }

    if (!post.permalink || !post.id) {
      return false;
    }

    if (seen.has(post.id)) {
      return false;
    }

    seen.add(post.id);
    const url = `https://reddit.com${post.permalink}`;
    const ageHours = Math.max(0.25, (now - createdMs) / (60 * 60 * 1000));

    posts.push({
      id: post.id,
      subreddit: post.subreddit,
      title: post.title || "",
      url,
      selftext: (post.selftext || "").slice(0, 1800),
      score: post.score || 0,
      comments: post.num_comments || 0,
      created_utc: post.created_utc,
      upvote_ratio: Number.isFinite(Number(post.upvote_ratio)) ? Number(post.upvote_ratio) : null,
      comments_per_hour: Number(((post.num_comments || 0) / ageHours).toFixed(2)),
      score_per_hour: Number(((post.score || 0) / ageHours).toFixed(2)),
      source_subreddit: source.subreddit || post.subreddit,
      source_query: source.query || null,
      source_sort: source.sort || null,
    });
    return true;
  };

  for (let i = 0; i < subreddits.length; i++) {
    const subreddit = subreddits[i];
    if (isBlockedSubreddit(subreddit)) {
      log(`Skipping blocked subreddit r/${subreddit}`);
      continue;
    }

    const queries = queryPackForSubreddit(subreddit, learning, attempt);
    const targets = [];
    const queryChunks = chunkArray(queries, 3);
    const isHighPriority = HIGH_PRIORITY_SUBREDDITS.has(String(subreddit || '').toLowerCase());

    for (const queryChunk of queryChunks) {
      const query = buildCombinedQuery(queryChunk);
      targets.push({
        query,
        sort: "top",
        url: `https://www.reddit.com/r/${subreddit}/search.json?q=${encodeURIComponent(query)}&sort=top&limit=35&t=${REDDIT_TOP_TIME_RANGE}&restrict_sr=1`,
        fallbackUrl: oldRedditSearchUrl(subreddit, query, "top", REDDIT_TOP_TIME_RANGE),
      });
    }

    if (isHighPriority && queryChunks[0]) {
      const query = buildCombinedQuery(queryChunks[0]);
      targets.push({
        query,
        sort: "new",
        url: `https://www.reddit.com/r/${subreddit}/search.json?q=${encodeURIComponent(query)}&sort=new&limit=25&t=day&restrict_sr=1`,
        fallbackUrl: oldRedditSearchUrl(subreddit, query, "new", "day"),
      });
    }

    for (const listing of listingUrlsForSubreddit(subreddit)) {
      targets.push({
        query: null,
        sort: listing.label,
        url: listing.url,
      });
    }
    
    try {
      const uniqueBefore = posts.length;
      log(`Fetching r/${subreddit}: ${queries.join(", ")} (${targets.length} request(s))...`);

      for (const target of targets) {
        const response = await fetchTextViaProxy(target.url, activeProxyUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          },
          timeout: 15000
        });

        if (!response.ok) {
          if (isProxyUnavailableStatus(response.status)) {
            throw new ProxyUnavailableError(
              `Proxy unavailable while fetching r/${subreddit}: ${describeHttpStatus(response.status)}`
            );
          }

          if (response.status === 429) {
            log(`Reddit rate limited r/${subreddit}: 429. Stopping this research fetch pass to avoid more failed requests.`);
            return posts;
          }

          if (response.status === 403) {
            let proxy403Attempts = 1;
            let lastResponse = response;
            const MAX_PROXY_403_ATTEMPTS = 2;

            // Try up to 2 different proxies before falling back to old.reddit
            while (proxy403Attempts < MAX_PROXY_403_ATTEMPTS && lastResponse.status === 403) {
              activeProxyUrl = nextProxyUrl(activeProxyUrl);
              proxy403Attempts += 1;
              
              log(`Reddit JSON fetch blocked for r/${subreddit}: 403. Trying alternative proxy (${proxyLabel(activeProxyUrl)})...`);
              
              try {
                lastResponse = await fetchTextViaProxy(target.url, activeProxyUrl, {
                  headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                  },
                  timeout: 15000
                });
                
                if (lastResponse.ok) {
                  // Success with new proxy - process the response
                  const data = await lastResponse.json();
                  const now = Date.now();
                  
                  for (const child of data.data?.children || []) {
                    addPost(child.data, now, {
                      subreddit,
                      query: target.query,
                      sort: target.sort,
                    });
                  }
                  
                  await delay(450);
                  break; // Exit retry loop - success
                }
              } catch (error) {
                log(`Error retrying with proxy during 403 handling for r/${subreddit}: ${error.message}`);
                lastResponse = { ok: false, status: 999 }; // Treat errors as failed attempt
              }
              
              await delay(900);
            }
            
            // If still 403 after trying proxies, attempt old.reddit fallback
            if (!lastResponse.ok && lastResponse.status === 403) {
              log(`Reddit JSON fetch blocked for r/${subreddit}: 403 on all ${proxy403Attempts} proxy attempt(s). Trying old Reddit fallback...`);
              let fallbackPosts = [];
              try {
                fallbackPosts = await fetchOldRedditFallback(target, subreddit);
              } catch (error) {
                if (error instanceof RedditRateLimitedError) {
                  log(`${error.message}. Stopping this research fetch pass to cool down.`);
                  return posts;
                }

                throw error;
              }
              const now = Date.now();
              for (const post of fallbackPosts) {
                addPost(post, now, {
                  subreddit,
                  query: post.source_query || target.query,
                  sort: post.source_sort || target.sort,
                });
              }
              await delay(900);
            }
            
            continue;
          }

          log(`Reddit fetch failed for r/${subreddit}: ${response.status}. Waiting before retry...`);
          await delay(6000);
          continue;
        }

        const data = await response.json();
        const now = Date.now();

        for (const child of data.data?.children || []) {
          addPost(child.data, now, {
            subreddit,
            query: target.query,
            sort: target.sort,
          });
        }

        await delay(450);
      }

      const added = posts.length - uniqueBefore;
      log(`r/${subreddit}: ${added} unique recent post(s) added from ${targets.length} request(s)`);

      if (i < subreddits.length - 1) {
        await delay(1200);
      }
    } catch (error) {
      if (error instanceof ProxyUnavailableError) {
        throw error;
      }

      if (error instanceof RedditRateLimitedError) {
        log(`${error.message}. Stopping this research fetch pass to cool down.`);
        return posts;
      }

      log(`Error fetching r/${subreddit}: ${error.message}`);
      await delay(6000);
    }
  }

  return posts;
}

function shortlistPosts(posts, learning = {}) {
  const normalizedLearning = normalizeLearning(learning);
  const learnedSubredditScores = new Map(
    normalizedLearning.topSubreddits.map((item, index) => [
      String(item.subreddit || '').toLowerCase(),
      Math.max(0, 20 - index * 3),
    ])
  );
  const learnedTerms = normalizedLearning.effectiveTerms
    .map((item) => String(item.term || '').toLowerCase())
    .filter(Boolean);
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

  const MIN_COMMENTS = 40;
  const MIN_UPVOTES = 15;
  const belowCommentThreshold = posts.filter((post) => post.comments < MIN_COMMENTS).length;
  const belowUpvoteThreshold = posts.filter((post) => post.score < MIN_UPVOTES).length;
  const maxComments = Math.max(0, ...posts.map((post) => post.comments || 0));
  const maxScore = Math.max(0, ...posts.map((post) => post.score || 0));

  log(
    `Shortlist thresholds: need ${MIN_COMMENTS}+ comments and ${MIN_UPVOTES}+ upvotes; max seen ${maxComments} comments / ${maxScore} upvotes; below comments ${belowCommentThreshold}/${posts.length}, below upvotes ${belowUpvoteThreshold}/${posts.length}`
  );

  return posts
    .filter((post) => {
      // Filtro mínimo: posts muy calientes con buen engagement
      if (post.comments < MIN_COMMENTS || post.score < MIN_UPVOTES) {
        return false;
      }
      return true;
    })
    .map((post) => {
      const text = `${post.title} ${post.selftext}`.toLowerCase();
      const keywordScore = keywords.reduce(
        (score, keyword) => score + (text.includes(keyword) ? 8 : 0),
        0
      );
      // Engagement score sin límites - recompensa posts muy calientes
      const engagementScore = (post.comments * 0.8) + (post.score * 0.4);
      // Bonus especial para r/claudecode - el mejor subreddit para visitas
      const subredditScore = String(post.subreddit).toLowerCase() === "claudecode" ? 35 : 
                            ["vibecoding", "claudeai"].includes(String(post.subreddit).toLowerCase()) ? 20 : 0;
      const learnedSubredditScore = learnedSubredditScores.get(String(post.subreddit).toLowerCase()) || 0;
      const learnedTermScore = learnedTerms.reduce(
        (score, term) => score + (text.includes(term) ? 6 : 0),
        0
      );
      const lowFitPenalty = /\b(showcase|built a|launched|roast my|look what i made)\b/i.test(text) ? 12 : 0;
      return {
        ...post,
        local_score: keywordScore + engagementScore + subredditScore + learnedSubredditScore + learnedTermScore - lowFitPenalty,
      };
    })
    .sort((a, b) => b.local_score - a.local_score)
    .slice(0, 150);
}

function shortlistPostsV2(posts, learning = {}) {
  const normalizedLearning = normalizeLearning(learning);
  const learnedSubredditScores = new Map(
    normalizedLearning.topSubreddits.map((item, index) => [
      String(item.subreddit || '').toLowerCase(),
      Math.max(0, 20 - index * 3),
    ])
  );
  const learnedTerms = normalizedLearning.effectiveTerms
    .map((item) => String(item.term || '').toLowerCase())
    .filter(Boolean);
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
    "technical cofounder",
    "debugging",
    "prompting",
    "spec",
    "workflow",
    "mvp",
  ];
  const goldenPatterns = [
    /\bcoding amateur\b/i,
    /\bnon[-\s]?technical\b/i,
    /\bdon'?t know how to code\b/i,
    /\bcan'?t code\b/i,
    /\bno programming skills\b/i,
    /\btechnical cofounder\b/i,
    /\bbuild (an? )?(app|mvp|product)\b/i,
    /\bproduct idea\b/i,
    /\bfirst (app|project|product)\b/i,
    /\bbuilt with claude\b/i,
    /\bclaude code\b/i,
    /\bship(ped|ping)?\b/i,
  ];
  const negativePatterns = [
    /\b(cursor|claude|chatgpt).{0,20}\b(vs|versus|better than)\b/i,
    /\bwhat'?s better\b/i,
    /\bshow me your\b/i,
    /\broast my\b/i,
    /\blearn (python|javascript|programming|to code)\b/i,
    /\bai replacing developers\b/i,
    /\bmarketing advice\b/i,
    /\bfundraising\b/i,
  ];

  const MIN_COMMENTS = 18;
  const MIN_UPVOTES = 12;
  const STRONG_FIT_MIN_COMMENTS = 5;
  const STRONG_FIT_MIN_UPVOTES = 5;
  const belowCommentThreshold = posts.filter((post) => post.comments < MIN_COMMENTS).length;
  const belowUpvoteThreshold = posts.filter((post) => post.score < MIN_UPVOTES).length;
  const maxComments = Math.max(0, ...posts.map((post) => post.comments || 0));
  const maxScore = Math.max(0, ...posts.map((post) => post.score || 0));

  log(
    `Shortlist thresholds: hot=${MIN_COMMENTS}+ comments/${MIN_UPVOTES}+ upvotes or strong-fit=${STRONG_FIT_MIN_COMMENTS}+ comments/${STRONG_FIT_MIN_UPVOTES}+ upvotes; max seen ${maxComments} comments / ${maxScore} upvotes; below hot comments ${belowCommentThreshold}/${posts.length}, below hot upvotes ${belowUpvoteThreshold}/${posts.length}`
  );

  const scored = posts
    .map((post) => {
      const text = `${post.title} ${post.selftext}`.toLowerCase();
      const keywordScore = keywords.reduce(
        (score, keyword) => score + (text.includes(keyword) ? 8 : 0),
        0
      );
      const goldenScore = goldenPatterns.reduce(
        (score, pattern) => score + (pattern.test(text) ? 18 : 0),
        0
      );
      const negativeScore = negativePatterns.reduce(
        (score, pattern) => score + (pattern.test(text) ? 18 : 0),
        0
      );
      const hotnessScore = Math.min(post.comments || 0, 180) * 0.85 + Math.min(post.score || 0, 800) * 0.32;
      const freshnessScore = Math.min(post.comments_per_hour || 0, 40) * 4 + Math.min(post.score_per_hour || 0, 120) * 1.4;
      const ratioScore = post.upvote_ratio ? Math.max(0, post.upvote_ratio - 0.7) * 45 : 0;
      const subredditKey = String(post.subreddit).toLowerCase();
      const subredditScore = subredditKey === "claudecode" ? 42 :
                            ["vibecoding", "claudeai"].includes(subredditKey) ? 28 :
                            ["sideproject", "nocode"].includes(subredditKey) ? 16 : 0;
      const learnedSubredditScore = learnedSubredditScores.get(subredditKey) || 0;
      const learnedTermScore = learnedTerms.reduce(
        (score, term) => score + (text.includes(term) ? 6 : 0),
        0
      );
      const showcasePenalty = /\b(showcase|look what i made)\b/i.test(text) && !/\b(coding amateur|non[-\s]?technical|first app|built with claude)\b/i.test(text) ? 16 : 0;
      const saturationPenalty = (post.comments || 0) > 220 ? 18 : 0;
      const fitScore = keywordScore + goldenScore + subredditScore + learnedSubredditScore + learnedTermScore - negativeScore - showcasePenalty;

      return {
        ...post,
        local_score: Number((fitScore + hotnessScore + freshnessScore + ratioScore - saturationPenalty).toFixed(2)),
        fit_score: fitScore,
        hotness_score: Number(hotnessScore.toFixed(2)),
        freshness_score: Number(freshnessScore.toFixed(2)),
      };
    })
    .filter((post) => {
      const isHotEnough = post.comments >= MIN_COMMENTS && post.score >= MIN_UPVOTES;
      const isStrongFit = post.fit_score >= 55 && post.comments >= STRONG_FIT_MIN_COMMENTS && post.score >= STRONG_FIT_MIN_UPVOTES;
      return isHotEnough || isStrongFit;
    })
    .sort((a, b) => b.local_score - a.local_score)
    .slice(0, 150);

  for (const post of scored.slice(0, 8)) {
    log(
      `Candidate ${Math.round(post.local_score)} | r/${post.subreddit} | ${post.score} upvotes | ${post.comments} comments | ${post.comments_per_hour}/h comments | "${post.title.slice(0, 90)}"`
    );
  }

  return scored;
}

function stripMarkdownFence(text) {
  return text
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
}

async function analyzeWithGemini(posts, knownPostUrls = [], learning = {}) {
  try {
    if (!GEMINI_API_KEY) {
      throw new Error("Gemini API key missing. Set GEMINI_API_KEY in the Railway environment.");
    }

    const knownUrls = [...new Set(knownPostUrls.filter(Boolean).map(normalizePostUrl))];
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`;
    const response = await fetch(`${endpoint}?key=${encodeURIComponent(GEMINI_API_KEY)}`, {
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
- Ensure each post meets AT LEAST 2 of the 3 must-have criteria.
- Do NOT suggest any post whose reddit_url appears in Already queued or blocked post URLs.
- Return VALID JSON ONLY. No explanations.

Already queued or blocked post URLs to avoid:
${JSON.stringify(knownUrls, null, 2)}

Historical performance learning:
${learningSummaryForPrompt(learning)}

Use the historical learning as a tie-breaker: prioritize similar subreddits, topics, timing patterns, and tones only when the post still meets all must-have criteria.

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
      if (response.status === 403 && /reported as leaked|PERMISSION_DENIED/i.test(detail)) {
        throw new Error(
          "Gemini API key was rejected as leaked. Rotate the key in Google AI Studio and update GEMINI_API_KEY in Railway."
        );
      }
      throw new Error(`Gemini request failed: ${response.status}. ${detail.slice(0, 220)}`);
    }

    const data = await response.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!rawText) {
      throw new Error("Gemini returned an empty response.");
    }

    log(`Raw Gemini response: ${rawText}`);
    return JSON.parse(stripMarkdownFence(rawText));
  } catch (error) {
    log(`Gemini analysis failed: ${error.message}`);
    throw error;
  }
}

function normalizeOpportunities(opportunities, knownPostUrls = [], sourcePosts = []) {
  if (!Array.isArray(opportunities)) return [];

  const knownPostUrlSet = buildKnownPostUrlSet(knownPostUrls);
  const sourcePostByUrl = new Map(
    sourcePosts
      .filter((post) => post?.url)
      .map((post) => [normalizePostUrl(post.url), post])
  );
  const subredditCount = {};
  const MAX_POSTS_PER_SUBREDDIT = 2;

  return opportunities
    .filter((item) => item && (item.reddit_url || item.url) && item.title)
    .filter((item) => {
      const postUrl = String(item.reddit_url || item.url || '');
      if (!knownPostUrlSet.has(normalizePostUrl(postUrl))) {
        return true;
      }

      log(`Skipping already known post: ${postUrl}`);
      return false;
    })
    .filter((item) => {
      const postUrl = String(item.reddit_url || item.url || '');
      const subreddit = extractSubredditFromUrl(postUrl).toLowerCase();
      if (isBlockedSubreddit(subreddit)) {
        log(`Skipping post from blocked subreddit r/${subreddit}: ${postUrl}`);
        return false;
      }
      
      subredditCount[subreddit] = (subredditCount[subreddit] || 0) + 1;
      
      if (subredditCount[subreddit] > MAX_POSTS_PER_SUBREDDIT) {
        log(`Skipping post from r/${subreddit} - already have ${MAX_POSTS_PER_SUBREDDIT} from this subreddit today`);
        return false;
      }
      
      return true;
    })
    .map((item) => {
      const redditUrl = String(item.reddit_url || item.url || "");
      const sourcePost = sourcePostByUrl.get(normalizePostUrl(redditUrl)) || {};

      return {
        reddit_url: redditUrl,
        title: String(item.title),
        reason: String(item.reason || item.opportunity || "Relevant opportunity."),
        reply: String(item.reply || item.suggested_reply || item.value_comment || ""),
        risk: normalizeRisk(item.risk),
        score: sourcePost.score || 0,
        comments: sourcePost.comments || 0,
        createdAtMs: Number(sourcePost.created_utc || 0) * 1000 || null,
        upvoteRatio: sourcePost.upvote_ratio ?? null,
        localScore: sourcePost.local_score || 0,
        fitScore: sourcePost.fit_score || 0,
        hotnessScore: sourcePost.hotness_score || 0,
        freshnessScore: sourcePost.freshness_score || 0,
        commentsPerHour: sourcePost.comments_per_hour || 0,
        scorePerHour: sourcePost.score_per_hour || 0,
        sourceSubreddit: sourcePost.source_subreddit || extractSubredditFromUrl(redditUrl),
        sourceQuery: sourcePost.source_query || null,
        sourceSort: sourcePost.source_sort || null,
      };
    });
}

function normalizeRisk(risk) {
  const normalized = String(risk || "none").toLowerCase().trim();
  if (normalized.includes("sensitive")) return "sensitive subreddit";
  if (normalized.includes("saturated")) return "saturated";
  if (normalized.includes("other")) return "other";
  return "none";
}

export async function runResearch(options = {}) {
  try {
    const knownPostUrls = Array.isArray(options.knownPostUrls) ? options.knownPostUrls : [];
    const learning = normalizeLearning(options.learning);
    const TARGET_OPPORTUNITIES = 4;
    const MAX_RESEARCH_ATTEMPTS = 12;
    let allOpportunities = [];
    let attempt = 0;

    log("Starting research module");
    
    const proxyOk = await verifyProxyIsWorking();
    if (!proxyOk) {
      log("Proxy verification failed. Skipping research until a proxy is available.");
      return [];
    }

    while (allOpportunities.length < TARGET_OPPORTUNITIES && attempt < MAX_RESEARCH_ATTEMPTS) {
      attempt++;
      log(`Research attempt ${attempt}/${MAX_RESEARCH_ATTEMPTS} (have ${allOpportunities.length}/${TARGET_OPPORTUNITIES} opportunities)`);
      
      const posts = await fetchRedditPosts(learning, attempt);
      log(`Fetched ${posts.length} top/relevant recent posts`);
      
      if (!posts.length) {
        log("No posts found in this attempt");
        if (attempt < MAX_RESEARCH_ATTEMPTS) {
          await delay(5000);
        }
        continue;
      }

      const shortlisted = shortlistPostsV2(posts, learning);
      log(`Shortlisted ${shortlisted.length} posts for analysis`);
      
      if (!shortlisted.length) {
        log("No posts passed shortlist filtering in this attempt");
        if (attempt < MAX_RESEARCH_ATTEMPTS) {
          await delay(5000);
        }
        continue;
      }

      const opportunities = await analyzeWithGemini(shortlisted, knownPostUrls, learning);
      const normalized = normalizeOpportunities(opportunities, knownPostUrls, shortlisted);
      
      log(`Found ${normalized.length} opportunities in this attempt`);
      for (const opportunity of normalized) {
        log(
          `Opportunity accepted | r/${extractSubredditFromUrl(opportunity.reddit_url)} | ${opportunity.score} upvotes | ${opportunity.comments} comments | query=${opportunity.sourceQuery || opportunity.sourceSort || "unknown"} | local=${Math.round(opportunity.localScore)} | "${opportunity.title.slice(0, 90)}"`
        );
      }
      allOpportunities = allOpportunities.concat(normalized);

      if (allOpportunities.length >= TARGET_OPPORTUNITIES) {
        log(`Reached target of ${TARGET_OPPORTUNITIES} opportunities`);
        break;
      }

      if (attempt < MAX_RESEARCH_ATTEMPTS) {
        log(`Need more opportunities, waiting before retry...`);
        await delay(5000);
      }
    }

    const finalOpportunities = allOpportunities.slice(0, TARGET_OPPORTUNITIES);
    log(`Research complete: ${finalOpportunities.length} opportunities found after ${attempt} attempt(s)`);
    return finalOpportunities;
  } catch (error) {
    log(`Research failed: ${error.message}`);
    throw error;
  }
}
