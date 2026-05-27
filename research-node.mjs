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
  "build without code",
  "no code startup",
  "side project",
  "launch product",
  "execution help",
  "technical founder",
  "build MVP",
  "code workflow",
  "startup problem",
  "ship fast",
  "idea to product",
  "non-technical builder",
];

const LANDING_PAGE = "https://buildwithclaude.vercel.app";

const SYSTEM_PROMPT = `You are a Reddit-native operator finding ONLY the most relevant reply opportunities for a specific digital product. Your job is strict filtering and writing useful comments that sound like they belong in the thread.

PRODUCT:
- Name: "From Idea to Shipped in 3 Days"
- URL: ${LANDING_PAGE}
- Description: A practical guide for non-developers and entrepreneurs who want to build and launch a digital product using Claude Code and AI, without knowing how to code.
- Ideal customer: entrepreneur, creator, freelancer, or professional with an idea who doesn't know how to execute it technically.

MUST-HAVE CRITERIA (post must match ALL 3):
1. Author is clearly NON-TECHNICAL (explicitly says they can't code, don't know how to code, not a developer) OR has a specific product/business idea with technical execution block
2. Post shows CONCRETE INTENT to BUILD or LAUNCH a real product/project (not theoretical, not asking about tools in general)
3. Post is asking for HELP with execution strategy, workflow, or how to overcome technical barrier - NOT asking for tool comparisons or which tool is "better"

BONUS CRITERIA (filter with these):
- Explicitly mentions "can't code", "don't know how to code", "no technical skills", "non-developer"
- Frustrated tone specifically about TECHNICAL execution being a blocker (not marketing, not sales, not other)
- Asks "how do I..." or "how should I..." about building/launching
- Author is entrepreneur, maker, creator, or freelancer with an idea
- Post is from last 24h (higher chance of visibility)

DISQUALIFY IF:
- Author mentions being a developer, engineer, or having technical skills
- Post is about tool features, comparisons, or "which tool is better"
- Post is casual discussion about AI/tech trends (not personal project)
- Post is low-effort, no clear question, or just venting without asking for help
- Post is older than 24 hours
- Already has multiple highly-upvoted expert answers (comment likely won't be seen)
- Problem is non-technical (marketing, sales, funding, time management, etc)
- Post is asking about learning to code (our product is for non-coders, not learning tools)

STRICT FILTERING:
- If a post only PARTIALLY matches must-have criteria, DISCARD IT
- If you find fewer than 4 genuinely excellent posts, return only those few (do NOT pad with weak matches)
- Better to return 1-2 perfect posts than 5 mediocre ones

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
  'http://aaubcdkx-gb-1:ecljgj60smyr@p.webshare.io:80',
  'http://aaubcdkx-ca-2:ecljgj60smyr@p.webshare.io:80',
  'http://aaubcdkx-de-3:ecljgj60smyr@p.webshare.io:80',
  'http://aaubcdkx-fr-4:ecljgj60smyr@p.webshare.io:80',
  'http://aaubcdkx-au-5:ecljgj60smyr@p.webshare.io:80',
  'http://aaubcdkx-nl-6:ecljgj60smyr@p.webshare.io:80',
  'http://aaubcdkx-it-7:ecljgj60smyr@p.webshare.io:80',
  'http://aaubcdkx-es-8:ecljgj60smyr@p.webshare.io:80',
  'http://aaubcdkx-be-9:ecljgj60smyr@p.webshare.io:80',
  'http://aaubcdkx-at-10:ecljgj60smyr@p.webshare.io:80',
];
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const MAX_POST_AGE_MS = 24 * 60 * 60 * 1000;
const REDDIT_TOP_TIME_RANGE = "week";
const MAX_PROXY_ATTEMPTS = 10;
const PROXY_RETRY_DELAY_MS = 3000;
const DATACENTER_IP_PREFIXES = ['34.', '35.', '52.', '54.', '18.', '3.', '44.'];
let activeProxyUrl = PROXY_URLS[0];

function log(message) {
  console.log(`[research-node] ${message}`);
}

function normalizePostUrl(postUrl) {
  try {
    const url = new URL(String(postUrl));
    url.protocol = 'https:';
    url.hostname = url.hostname.replace(/^www\./i, '').toLowerCase();
    url.hash = '';
    url.search = '';
    url.pathname = url.pathname.replace(/\/$/, '');
    return url.toString();
  } catch {
    return String(postUrl || '').trim().replace(/\/$/, '');
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
      log(`Proxy verification failed: HTTP ${response.status}`);
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

async function fetchRedditPosts(learning = {}) {
  const posts = [];
  const seen = new Set();
  const subreddits = rankedSubredditsFromLearning(learning);

  const addPost = (post, now) => {
    const createdMs = (post.created_utc || 0) * 1000;

    if (now - createdMs > MAX_POST_AGE_MS) {
      return;
    }

    if (!post.permalink || seen.has(post.id)) {
      return;
    }

    seen.add(post.id);
    const url = `https://reddit.com${post.permalink}`;

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
  };

  for (let i = 0; i < subreddits.length; i++) {
    const subreddit = subreddits[i];
    if (isBlockedSubreddit(subreddit)) {
      log(`Skipping blocked subreddit r/${subreddit}`);
      continue;
    }

    const query = queryForIndex(i, learning);
    
    try {
      log(`Fetching r/${subreddit} for "${query}"...`);
      
      const urls = [
        `https://www.reddit.com/r/${subreddit}/search.json?q=${encodeURIComponent(query)}&sort=top&limit=25&t=${REDDIT_TOP_TIME_RANGE}&restrict_sr=1`,
        `https://www.reddit.com/r/${subreddit}/top.json?limit=25&t=${REDDIT_TOP_TIME_RANGE}`,
      ];

      for (const url of urls) {
        const response = await fetchTextViaProxy(url, activeProxyUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          },
          timeout: 15000
        });

        if (!response.ok) {
          log(`Reddit fetch failed for r/${subreddit}: ${response.status}. Waiting before retry...`);
          await delay(6000);
          continue;
        }

        const data = await response.json();
        const now = Date.now();

        for (const child of data.data?.children || []) {
          addPost(child.data, now);
        }

        await delay(1500);
      }

      if (i < subreddits.length - 1) {
        await delay(4500);
      }
    } catch (error) {
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

function normalizeOpportunities(opportunities, knownPostUrls = []) {
  if (!Array.isArray(opportunities)) return [];

  const knownPostUrlSet = buildKnownPostUrlSet(knownPostUrls);
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
      
      const posts = await fetchRedditPosts(learning);
      log(`Fetched ${posts.length} top/relevant recent posts`);
      
      if (!posts.length) {
        log("No posts found in this attempt");
        if (attempt < MAX_RESEARCH_ATTEMPTS) {
          await delay(5000);
        }
        continue;
      }

      const shortlisted = shortlistPosts(posts, learning);
      log(`Shortlisted ${shortlisted.length} posts for analysis`);
      
      if (!shortlisted.length) {
        log("No posts passed shortlist filtering in this attempt");
        if (attempt < MAX_RESEARCH_ATTEMPTS) {
          await delay(5000);
        }
        continue;
      }

      const opportunities = await analyzeWithGemini(shortlisted, knownPostUrls, learning);
      const normalized = normalizeOpportunities(opportunities, knownPostUrls);
      
      log(`Found ${normalized.length} opportunities in this attempt`);
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
