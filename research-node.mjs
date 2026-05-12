import { HttpProxyAgent } from 'http-proxy-agent';
import { HttpsProxyAgent } from 'https-proxy-agent';

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

const PROXY_URL = 'http://k7ylAHOvzHPNj04m:RExx2IDogCap32JZ@geo.iproyal.com:12321';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "AIzaSyAfKQOjTD1Q95tbvRJq6w3eAUMaFX_5pNs";
const MAX_POST_AGE_MS = 48 * 60 * 60 * 1000;

function log(message) {
  console.log(`[research-node] ${message}`);
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function verifyProxyIsWorking() {
  try {
    log("Verifying proxy connection...");
    
    const httpAgent = new HttpProxyAgent(PROXY_URL);
    const httpsAgent = new HttpsProxyAgent(PROXY_URL);
    
    const response = await fetch('https://ipv4.icanhazip.com', {
      httpAgent,
      httpsAgent,
      timeout: 10000
    });

    if (!response.ok) {
      log(`Proxy verification failed: HTTP ${response.status}`);
      return false;
    }

    const text = await response.text();
    const ipMatch = text.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/);
    
    if (ipMatch) {
      const proxyIp = ipMatch[0];
      log(`Proxy is working. Detected IP: ${proxyIp}`);
      return true;
    } else {
      log("Proxy response received but could not parse IP");
      return false;
    }
  } catch (error) {
    log(`Proxy verification failed: ${error.message}`);
    return false;
  }
}

async function fetchRedditPosts() {
  const httpAgent = new HttpProxyAgent(PROXY_URL);
  const httpsAgent = new HttpsProxyAgent(PROXY_URL);
  const posts = [];
  const seen = new Set();

  for (let i = 0; i < SUBREDDITS.length; i++) {
    const subreddit = SUBREDDITS[i];
    const query = SEARCH_QUERIES[i % SEARCH_QUERIES.length];
    
    try {
      log(`Fetching r/${subreddit} for "${query}"...`);
      
      const url = `https://www.reddit.com/r/${subreddit}/search.json?q=${encodeURIComponent(query)}&sort=new&limit=25&t=day&restrict_sr=1`;
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        httpAgent,
        httpsAgent,
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

async function analyzeWithGemini(posts) {
  try {
    // List available models for debugging
    try {
      const modelsUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(GEMINI_API_KEY)}`;
      const modelsResponse = await fetch(modelsUrl);
      const modelsData = await modelsResponse.json();
      log(`Available Gemini models: ${JSON.stringify(modelsData, null, 2)}`);
    } catch (err) {
      log(`Could not fetch models list: ${err.message}`);
    }

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent`;
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
      throw new Error(`Gemini request failed: ${response.status}. ${detail.slice(0, 220)}`);
    }

    const data = await response.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!rawText) {
      throw new Error("Gemini returned an empty response.");
    }

    return JSON.parse(stripMarkdownFence(rawText));
  } catch (error) {
    log(`Gemini analysis failed: ${error.message}`);
    throw error;
  }
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

export async function runResearch() {
  try {
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
    
    const opportunities = await analyzeWithGemini(shortlisted);
    const normalized = normalizeOpportunities(opportunities);
    
    log(`Research complete: ${normalized.length} opportunities found`);
    return normalized;
  } catch (error) {
    log(`Research failed: ${error.message}`);
    throw error;
  }
}
