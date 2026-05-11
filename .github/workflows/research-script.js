const SUBREDDITS = ['SideProject', 'nocode', 'Entrepreneur', 'artificial', 'ChatGPT', 'startups', 'indiehackers', 'passive_income', 'ClaudeCode', 'vibecoding', 'ClaudeAI'];
const SEARCH_QUERIES = ['how to build', 'no code', 'Claude Code', 'launch idea', 'build without coding', 'AI to build', 'ship product', 'no developer', 'build app idea', 'side project'];
const GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite'];
const LANDING_PAGE = 'https://buildwithclaude.vercel.app';
const FETCH_TIMEOUT_MS = 15000;

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

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`Request timed out after ${FETCH_TIMEOUT_MS / 1000}s for ${url}`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchSubredditSearch(subreddit, query) {
  const url = `https://www.reddit.com/r/${encodeURIComponent(subreddit)}/search.json?q=${encodeURIComponent(query)}&sort=new&limit=25&t=week&restrict_sr=1`;
  const response = await fetchWithTimeout(url, {
    headers: {
      'User-Agent': 'RedditScanner/1.0',
      'Accept': 'application/json'
    }
  });

  if (response.status === 429) {
    console.log(`Rate limited by r/${subreddit}. Retrying in 2 seconds...`);
    await delay(2000);
    const retry = await fetchWithTimeout(url, {
      headers: {
        'User-Agent': 'RedditScanner/1.0',
        'Accept': 'application/json'
      }
    });
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

async function fetchRecentRedditPosts() {
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const posts = [];
  const seen = new Set();

  for (let index = 0; index < SUBREDDITS.length; index += 1) {
    const subreddit = SUBREDDITS[index];
    const query = SEARCH_QUERIES[index % SEARCH_QUERIES.length];
    console.log(`Fetching r/${subreddit} for "${query}"...`);

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
        title: post.title || '',
        url,
        selftext: (post.selftext || '').slice(0, 1800),
        score: post.score || 0,
        comments: post.num_comments || 0,
        created_utc: post.created_utc
      });
    }

    if (index < SUBREDDITS.length - 1) {
      await delay(1000);
    }
  }
  return posts;
}

function shortlistPosts(posts) {
  const keywords = ['no code', 'nocode', 'without coding', "don't know how to code", 'non technical', 'non-technical', 'build app', 'build an app', 'app idea', 'launch', 'side project', 'startup idea', 'ship', 'ai to build', 'claude', 'claude code', 'cursor', 'copilot', 'developer', 'technical cofounder'];
  
  return posts.map((post) => {
    const text = `${post.title} ${post.selftext}`.toLowerCase();
    const keywordScore = keywords.reduce((score, keyword) => score + (text.includes(keyword) ? 8 : 0), 0);
    const engagementScore = Math.min(post.comments, 25) + Math.min(post.score, 40) / 4;
    return { ...post, local_score: keywordScore + engagementScore };
  }).sort((a, b) => b.local_score - a.local_score).slice(0, 35);
}

async function callGeminiModel(posts, apiKey, model) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const response = await fetchWithTimeout(`${endpoint}?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        role: 'user',
        parts: [{
          text: `${SYSTEM_PROMPT}

CRITICAL: Analyze these Reddit posts and identify ONLY the BEST 5-10 matches.
- If fewer than 5 are genuinely excellent, return fewer.
- Do NOT pad with weak matches.
- Ensure each post meets ALL three must-have criteria.
- Return VALID JSON ONLY. No explanations.

Posts to analyze:
${JSON.stringify(posts, null, 2)}`
        }]
      }],
      generationConfig: {
        temperature: 0.3,
        responseMimeType: 'application/json'
      }
    })
  });

  if (!response.ok) {
    const detail = await response.text();
    if (response.status === 429) {
      throw new Error('Gemini quota exceeded. Try again later.');
    }
    const error = new Error(`Gemini request failed on ${model}: ${response.status}`);
    error.retryable = response.status === 503 || response.status === 500;
    throw error;
  }

  const data = await response.json();
  const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) {
    throw new Error('Gemini returned an empty response.');
  }
  return JSON.parse(rawText.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim());
}

async function analyzeWithGemini(posts, apiKey) {
  let lastError;
  for (const model of GEMINI_MODELS) {
    console.log(`Scoring ${posts.length} posts with ${model}...`);
    try {
      return await callGeminiModel(posts, apiKey, model);
    } catch (error) {
      lastError = error;
      if (!error.retryable) throw error;
      console.log(`${model} is busy. Trying fallback model...`);
      await delay(800);
    }
  }
  throw lastError || new Error('Gemini analysis failed.');
}

function normalizeOpportunities(opportunities) {
  if (!Array.isArray(opportunities)) return [];
  return opportunities
    .filter((item) => item && (item.reddit_url || item.url) && item.title)
    .map((item) => ({
      reddit_url: String(item.reddit_url || item.url || ''),
      title: String(item.title),
      reason: String(item.reason || item.opportunity || 'Relevant opportunity.'),
      reply: String(item.reply || item.suggested_reply || item.value_comment || ''),
      risk: String(item.risk || 'none').toLowerCase().trim()
    }));
}

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  const railwayUrl = process.env.RAILWAY_URL || 'https://redditauth2-production.up.railway.app';
  
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY environment variable is not set');
  }

  console.log('Starting Reddit research scan...');
  const posts = await fetchRecentRedditPosts();
  if (!posts.length) {
    console.log('No Reddit posts found');
    return;
  }

  console.log(`Fetched ${posts.length} posts, shortlisting...`);
  const shortlisted = shortlistPosts(posts);
  console.log(`Analyzing ${shortlisted.length} shortlisted posts with Gemini...`);
  const opportunities = await analyzeWithGemini(shortlisted, apiKey);
  const normalized = normalizeOpportunities(opportunities);

  if (normalized.length > 10) {
    console.log(`Found ${normalized.length} matches, limiting to top 10.`);
    normalized.length = 10;
  }

  console.log(`Queuing ${normalized.length} opportunities...`);
  for (const opportunity of normalized) {
    try {
      const queueUrl = railwayUrl + '/api/queue/add';
      const response = await fetchWithTimeout(queueUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          postUrl: opportunity.reddit_url,
          commentText: opportunity.reply,
          subreddit: opportunity.reddit_url.match(/\/r\/([^\/]+)/)?.[1] || 'unknown'
        })
      });

      if (!response.ok) {
        const errorBody = await response.text();
        console.log(`Failed to queue ${opportunity.reddit_url}: ${response.status} ${errorBody}`);
        continue;
      }

      console.log(`Queued ${opportunity.reddit_url}`);
    } catch (error) {
      console.log(`Error queuing ${opportunity.reddit_url}: ${error.message}`);
    }
  }

  console.log('Research scan complete');
}

main().catch(error => {
  console.error('Fatal error:', error.message);
  process.exit(1);
});
