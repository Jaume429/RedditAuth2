import { HttpsProxyAgent } from 'https-proxy-agent';
import { request as httpsRequest } from 'node:https';

const SUBREDDITS = [
  "SideProject",
  "nocode",
  "Entrepreneur",
  "artificial",
  "ChatGPT",
  "startups",
  "indiehackers",
];

const SEARCH_QUERIES = [
  "how to build",
  "no code",
  "launch idea",
  "build without coding",
  "AI to build",
  "ship product",
  "no developer",
];

const LANDING_PAGE = "https://buildwithclaude.vercel.app";

const SYSTEM_PROMPT = `You are a marketing agent specialized in finding ONLY THE MOST RELEVANT Reddit opportunities for a specific digital product. Your job is strict filtering - return FEWER posts if needed, but only those that are truly excellent matches.

PRODUCT:
- Name: "From Idea to Shipped in 3 Days"
- URL: ${LANDING_PAGE}
- Description: A practical guide for non-developers and entrepreneurs who want to build and launch a digital product using Claude Code and AI, without knowing how to code.
- Ideal customer: entrepreneur, creator, freelancer, or professional with an idea who doesn't know how to execute it technically.

MUST-HAVE CRITERIA (post must match ALL 3):
1. Author is clearly non-technical AND has a specific idea/problem to solve (not just casual interest)
2. Post shows real intent to BUILD or LAUNCH something (not just asking about AI in general)
3. Post is asking for help, resources, or alternatives-not already solved or promotional

BONUS CRITERIA (prioritize posts matching these):
- Explicitly mentions "no code", "without coding", or inability to code technically
- Mentions Claude Code, Cursor, Copilot, or other AI coding tools
- Frustrated tone about technical limitations blocking their execution
- Urgency signals: "ship fast", "launch soon", "side project", "startup idea"

DISQUALIFY IF:
- Post is from a developer/technical builder (even if interested in AI tools)
- Post is only casually discussing AI or technology news
- Post is low-effort ("help" or no clear question)
- Post is older than 7 days
- Already has multiple highly-upvoted expert answers
- Strongly negative tone toward AI
- OP is complaining about a tool not working or asking for specific no-code tool recommendations instead of asking how to build/launch
- OP is comparing tools or asking "what's better: X or Y tool" - these are not our posts

STRICT FILTERING:
- If a post only PARTIALLY matches must-have criteria, DISCARD IT
- If you find fewer than 5 genuinely excellent posts, return only those few (do NOT pad with weak matches)
- Better to return 2 perfect posts than 8 mediocre ones

OUTPUT FORMAT (MANDATORY):
Return ONLY a JSON array. No markdown, no explanations, no extra text before or after. All fields are required.

[
  {
    "reddit_url": "https://reddit.com/r/...",
    "title": "exact post title",
    "reason": "1-2 sentences explaining why this post is an excellent fit (be specific about which criteria it matches)",
    "reply": "Read the post carefully and identify THE SPECIFIC question or pain point the OP is asking about. Then respond DIRECTLY to that question - nothing else. Rules: (1) Answer their exact question/problem, not a related topic. (2) Maximum 3 sentences total, no exceptions. (3) NO exclamation marks. (4) NO filler phrases like 'That's powerful' or 'I found this helpful'. (5) Sound like a real person sharing one specific thing they experienced, not a marketer. (6) The link comes last as an afterthought, directly related to what you just said. (7) Use 'put something together' or 'wrote it down' instead of 'guide'. (8) Casual, direct tone. (9) VARY THE ENDING EVERY TIME - never use the same closing phrase twice. Vary how you introduce the link: sometimes use 'Here's', sometimes 'Check', sometimes 'I wrote this down', sometimes just reference it naturally. Make each comment sound unique even if the link is the same. Example openers: 'Spent 6 months...', 'Did the exact same thing...', 'Ran into this problem...', 'Yeah that was my issue too...'",
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
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "AIzaSyAfKQOjTD1Q95tbvRJq6w3eAUMaFX_5pNs";
const MAX_POST_AGE_MS = 48 * 60 * 60 * 1000;
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

async function fetchRedditPosts() {
  const posts = [];
  const seen = new Set();

  for (let i = 0; i < SUBREDDITS.length; i++) {
    const subreddit = SUBREDDITS[i];
    const query = SEARCH_QUERIES[i % SEARCH_QUERIES.length];
    
    try {
      log(`Fetching r/${subreddit} for "${query}"...`);
      
      const url = `https://www.reddit.com/r/${subreddit}/search.json?q=${encodeURIComponent(query)}&sort=new&limit=25&t=day&restrict_sr=1`;
      const response = await fetchTextViaProxy(url, activeProxyUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        timeout: 15000
      });

      if (!response.ok) {
        log(`Reddit fetch failed for r/${subreddit}: ${response.status}`);
        continue;
      }

      const data = await response.json();
      const now = Date.now();

      for (const child of data.data?.children || []) {
        const post = child.data;
        const createdMs = (post.created_utc || 0) * 1000;

        if (now - createdMs > MAX_POST_AGE_MS) {
          continue;
        }

        if (!post.permalink || seen.has(post.id)) {
          continue;
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
      }

      if (i < SUBREDDITS.length - 1) {
        await delay(1000);
      }
    } catch (error) {
      log(`Error fetching r/${subreddit}: ${error.message}`);
    }
  }

  return posts;
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
  ];

  return posts
    .map((post) => {
      const text = `${post.title} ${post.selftext}`.toLowerCase();
      const keywordScore = keywords.reduce(
        (score, keyword) => score + (text.includes(keyword) ? 8 : 0),
        0
      );
      const engagementScore = Math.min(post.comments, 25) + Math.min(post.score, 40) / 4;
      return { ...post, local_score: keywordScore + engagementScore };
    })
    .sort((a, b) => b.local_score - a.local_score)
    .slice(0, 35);
}

function stripMarkdownFence(text) {
  return text
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
}

async function analyzeWithGemini(posts, knownPostUrls = []) {
  try {
    const knownUrls = [...new Set(knownPostUrls.filter(Boolean).map(String))];
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
- Ensure each post meets ALL three must-have criteria.
- Do NOT suggest any post whose reddit_url appears in Already queued or blocked post URLs.
- Return VALID JSON ONLY. No explanations.

Already queued or blocked post URLs to avoid:
${JSON.stringify(knownUrls, null, 2)}

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
    log("Starting research module");
    
    const proxyOk = await verifyProxyIsWorking();
    if (!proxyOk) {
      log("Warning: proxy verification failed, but continuing anyway...");
    }
    
    const posts = await fetchRedditPosts();
    log(`Fetched ${posts.length} recent posts`);
    
    if (!posts.length) {
      log("No posts found");
      return [];
    }

    const shortlisted = shortlistPosts(posts);
    log(`Shortlisted ${shortlisted.length} posts for analysis`);
    
    const opportunities = await analyzeWithGemini(shortlisted, knownPostUrls);
    const normalized = normalizeOpportunities(opportunities, knownPostUrls);
    
    log(`Research complete: ${normalized.length} opportunities found`);
    return normalized;
  } catch (error) {
    log(`Research failed: ${error.message}`);
    throw error;
  }
}
