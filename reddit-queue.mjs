import { readFile, writeFile } from 'node:fs/promises';
import { request as httpsRequest } from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { postComment } from './reddit-poster.mjs';
import { runResearch } from './research-node.mjs';

const QUEUE_FILE = path.resolve(process.cwd(), 'queue.json');
const BLOCKED_POSTS_FILE = path.resolve(process.cwd(), 'blocked-posts.json');
const ANALYTICS_FILE = path.resolve(process.cwd(), 'reddit-analytics.json');
const LEARNING_FILE = path.resolve(process.cwd(), 'reddit-learning.json');
const PROXY_URL = 'http://aaubcdkx-es-8:ecljgj60smyr@p.webshare.io:80';
const MIN_DELAY_MS = 2 * 60 * 60 * 1000;
const MAX_DELAY_MS = 3 * 60 * 60 * 1000;
const MAX_POSTS_PER_DAY = 4;
const MAX_POST_AGE_MS = 48 * 60 * 60 * 1000;
const DAILY_JOB_HOUR_UTC = 7;
const QUEUE_PROCESS_INTERVAL_MS = 10 * 60 * 1000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const METRIC_REFRESH_WINDOWS = [
  { label: '24h', ageMs: 24 * 60 * 60 * 1000 },
  { label: '48h', ageMs: 48 * 60 * 60 * 1000 },
];
const BLOCKED_SUBREDDITS = new Set([
  'startups',
]);
let queueProcessorRunning = false;
let dailyJobRunning = false;

function log(message) {
  console.log(`[reddit-queue] ${message}`);
}

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function startOfToday() {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now;
}

function isSameDay(isoTimestamp) {
  if (!isoTimestamp) return false;
  const stamp = new Date(isoTimestamp);
  return stamp >= startOfToday();
}

function isTodayUtcDate(isoTimestamp) {
  if (!isoTimestamp) return false;
  const stamp = new Date(isoTimestamp);
  if (Number.isNaN(stamp.getTime())) return false;

  const now = new Date();
  return stamp.toISOString().slice(0, 10) === now.toISOString().slice(0, 10);
}

function extractSubreddit(postUrl) {
  const match = String(postUrl).match(/\/r\/([^/]+)/i);
  return match?.[1] || 'unknown';
}

function isBlockedSubreddit(subreddit) {
  return BLOCKED_SUBREDDITS.has(String(subreddit || '').toLowerCase());
}

function normalizeQueue(queue) {
  return Array.isArray(queue) ? queue : [];
}

function normalizeBlockedPosts(blockedPosts) {
  return Array.isArray(blockedPosts) ? blockedPosts : [];
}

function normalizeAnalytics(analytics) {
  return {
    publications: Array.isArray(analytics?.publications) ? analytics.publications : [],
    lastWeeklyAnalysisAt: analytics?.lastWeeklyAnalysisAt || null,
  };
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

async function readQueue() {
  try {
    const raw = await readFile(QUEUE_FILE, 'utf8');
    return normalizeQueue(JSON.parse(raw));
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

async function writeQueue(queue) {
  await writeFile(QUEUE_FILE, JSON.stringify(queue, null, 2), 'utf8');
}

async function readBlockedPosts() {
  try {
    const raw = await readFile(BLOCKED_POSTS_FILE, 'utf8');
    return normalizeBlockedPosts(JSON.parse(raw));
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

async function writeBlockedPosts(blockedPosts) {
  await writeFile(BLOCKED_POSTS_FILE, JSON.stringify(blockedPosts, null, 2), 'utf8');
}

async function readAnalytics() {
  try {
    const raw = await readFile(ANALYTICS_FILE, 'utf8');
    return normalizeAnalytics(JSON.parse(raw));
  } catch (error) {
    if (error.code === 'ENOENT') {
      return normalizeAnalytics({});
    }
    throw error;
  }
}

async function writeAnalytics(analytics) {
  await writeFile(ANALYTICS_FILE, JSON.stringify(normalizeAnalytics(analytics), null, 2), 'utf8');
}

async function readLearning() {
  try {
    const raw = await readFile(LEARNING_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function writeLearning(learning) {
  await writeFile(LEARNING_FILE, JSON.stringify(learning, null, 2), 'utf8');
}

async function isBlockedPostUrl(postUrl) {
  const blockedPosts = await readBlockedPosts();
  const normalizedPostUrl = normalizePostUrl(postUrl);
  return blockedPosts.some((blockedPostUrl) => normalizePostUrl(blockedPostUrl) === normalizedPostUrl);
}

function queueHasPostUrl(queue, postUrl) {
  const normalizedPostUrl = normalizePostUrl(postUrl);
  return queue.some((item) => normalizePostUrl(item.postUrl) === normalizedPostUrl);
}

function getQueuePostUrls(queue) {
  return queue.map((item) => item.postUrl).filter(Boolean);
}

async function getPublishedPostUrls() {
  const analytics = await readAnalytics();
  return (analytics.publications || [])
    .filter((pub) => pub.status === 'posted')
    .map((pub) => pub.postUrl)
    .filter(Boolean);
}

async function blockPostUrl(postUrl) {
  const blockedPosts = await readBlockedPosts();
  const normalizedPostUrl = normalizePostUrl(postUrl);
  if (blockedPosts.some((blockedPostUrl) => normalizePostUrl(blockedPostUrl) === normalizedPostUrl)) {
    return;
  }

  blockedPosts.push(postUrl);
  await writeBlockedPosts(blockedPosts);
  log(`Marked post as permanently blocked: ${postUrl}`);
}

function isGoldOpportunity(comments, score) {
  return comments >= 300 && score >= 100;
}

function buildQueueItem(postUrl, commentText, subreddit, scheduledAt, context = {}) {
  const isGold = isGoldOpportunity(context.comments || 0, context.score || 0);
  const priority = isGold ? 'high' : 'normal';
  return {
    id: `queue_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    postUrl,
    commentText,
    subreddit,
    title: context.title || '',
    opportunityReason: context.reason || '',
    status: 'pending',
    priority,
    scheduledAt,
    postedAt: null,
  };
}

function countPostedToday(queue) {
  return queue.filter((item) => item.status === 'posted' && isSameDay(item.postedAt)).length;
}

function countActiveToday(queue) {
  return queue.filter(
    (item) => ['pending', 'posted'].includes(item.status) && isSameDay(item.scheduledAt)
  ).length;
}

function countPostedTodayForSubreddit(queue, subreddit) {
  return queue.filter(
    (item) =>
      item.status === 'posted' &&
      item.subreddit.toLowerCase() === subreddit.toLowerCase() &&
      isSameDay(item.postedAt)
  ).length;
}

function nextScheduleBase(queue) {
  const pendingOrPosted = queue
    .map((item) => item.scheduledAt)
    .filter(Boolean)
    .map((value) => new Date(value).getTime())
    .filter((value) => Number.isFinite(value));

  const latest = pendingOrPosted.length ? Math.max(...pendingOrPosted) : Date.now();
  return Math.max(Date.now(), latest);
}

function nextScheduledAt(queue) {
  const scheduledCountToday = queue.filter(
    (item) => ['pending', 'posted'].includes(item.status) && isSameDay(item.scheduledAt)
  ).length;
  const base = nextScheduleBase(queue);
  const delay = scheduledCountToday > 0 ? randomBetween(MIN_DELAY_MS, MAX_DELAY_MS) : 0;
  return new Date(base + delay).toISOString();
}

function nextDailyJobDate(from = new Date()) {
  const nextRun = new Date(from);
  nextRun.setUTCHours(DAILY_JOB_HOUR_UTC, 0, 0, 0);

  if (nextRun <= from) {
    nextRun.setUTCDate(nextRun.getUTCDate() + 1);
  }

  return nextRun;
}

function appendJsonSuffix(postUrl) {
  const url = new URL(postUrl);
  url.hostname = 'www.reddit.com';
  const cleanPath = url.pathname.replace(/\/$/, '');
  url.pathname = `${cleanPath}.json`;
  url.search = 'raw_json=1';
  return url.toString();
}

function fetchTextViaProxy(url, proxyUrl, options = {}) {
  const redirectCount = options.redirectCount || 0;

  return new Promise((resolve, reject) => {
    const request = httpsRequest(url, {
      method: 'GET',
      headers: options.headers || {},
      agent: new HttpsProxyAgent(proxyUrl),
      timeout: options.timeout || 15000,
    }, (response) => {
      const chunks = [];

      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        if (
          [301, 302, 303, 307, 308].includes(response.statusCode) &&
          response.headers.location &&
          redirectCount < 5
        ) {
          const redirectUrl = new URL(response.headers.location, url).toString();
          resolve(fetchTextViaProxy(redirectUrl, proxyUrl, {
            ...options,
            redirectCount: redirectCount + 1,
          }));
          return;
        }

        const body = Buffer.concat(chunks).toString('utf8');
        resolve({
          ok: response.statusCode >= 200 && response.statusCode < 300,
          status: response.statusCode,
          text: async () => body,
          json: async () => JSON.parse(body),
        });
      });
    });

    request.on('timeout', () => {
      request.destroy(new Error(`Request timed out after ${options.timeout || 15000}ms`));
    });
    request.on('error', reject);
    request.end();
  });
}

async function fetchPostMetadata(postUrl) {
  const response = await fetchTextViaProxy(appendJsonSuffix(postUrl), PROXY_URL, {
    headers: {
      'User-Agent': 'RedditAuthQueue/1.0',
      accept: 'application/json',
    },
    timeout: 15000,
  });

  if (!response.ok) {
    throw new Error(`Could not fetch post metadata (${response.status}) for ${postUrl}`);
  }

  const data = await response.json();
  const postData = data?.[0]?.data?.children?.[0]?.data;

  if (!postData) {
    throw new Error(`Unexpected Reddit metadata payload for ${postUrl}`);
  }

  return {
    subreddit: postData.subreddit || extractSubreddit(postUrl),
    createdAtMs: Number(postData.created_utc || 0) * 1000,
    title: postData.title || '',
    locked: Boolean(postData.locked),
    archived: Boolean(postData.archived),
    score: Number(postData.score || 0),
    comments: Number(postData.num_comments || 0),
    awards: Number(postData.total_awards_received || 0),
    views: Number.isFinite(Number(postData.view_count)) ? Number(postData.view_count) : null,
    upvoteRatio: Number.isFinite(Number(postData.upvote_ratio)) ? Number(postData.upvote_ratio) : null,
  };
}

function buildMetricsSnapshot(metadata, label = 'posted') {
  return {
    label,
    capturedAt: new Date().toISOString(),
    score: Number(metadata?.score || 0),
    comments: Number(metadata?.comments || 0),
    awards: Number(metadata?.awards || 0),
    views: metadata?.views ?? null,
    upvoteRatio: metadata?.upvoteRatio ?? null,
  };
}

function engagementValue(snapshot) {
  return Number(snapshot?.score || 0) + Number(snapshot?.comments || 0) * 2 + Number(snapshot?.awards || 0) * 5;
}

async function recordPublication(item, status, options = {}) {
  const analytics = await readAnalytics();
  const postedAt = options.postedAt || null;
  const existingIndex = analytics.publications.findIndex(
    (publication) => publication.queueId === item.id || normalizePostUrl(publication.postUrl) === normalizePostUrl(item.postUrl)
  );
  const existing = existingIndex >= 0 ? analytics.publications[existingIndex] : null;
  const snapshots = Array.isArray(existing?.metricsSnapshots) ? existing.metricsSnapshots : [];

  if (options.metadata && !snapshots.some((snapshot) => snapshot.label === 'posted')) {
    snapshots.push(buildMetricsSnapshot(options.metadata, 'posted'));
  }

  const publication = {
    ...(existing || {}),
    queueId: item.id,
    postUrl: item.postUrl,
    subreddit: item.subreddit,
    title: options.metadata?.title || existing?.title || item.title || '',
    opportunityReason: item.opportunityReason || existing?.opportunityReason || '',
    commentText: item.commentText,
    scheduledAt: item.scheduledAt || existing?.scheduledAt || null,
    postedAt: postedAt || existing?.postedAt || null,
    status,
    finalStateAt: new Date().toISOString(),
    failureDetails: status === 'failed' ? options.failureDetails || existing?.failureDetails || null : null,
    metricsSnapshots: snapshots,
  };

  if (existingIndex >= 0) {
    analytics.publications[existingIndex] = publication;
  } else {
    analytics.publications.push(publication);
  }

  await writeAnalytics(analytics);
}

function tokenize(text) {
  const stopWords = new Set([
    'about', 'after', 'again', 'also', 'and', 'any', 'are', 'build', 'but', 'can', 'cant', 'code',
    'coding', 'for', 'from', 'get', 'have', 'how', 'into', 'just', 'like', 'need', 'not', 'now',
    'that', 'the', 'this', 'use', 'using', 'what', 'when', 'with', 'without', 'you', 'your',
  ]);

  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length >= 4 && !stopWords.has(word));
}

function latestSnapshot(publication) {
  const snapshots = Array.isArray(publication.metricsSnapshots) ? publication.metricsSnapshots : [];
  return snapshots[snapshots.length - 1] || null;
}

async function refreshTrackedMetrics() {
  const analytics = await readAnalytics();
  let changed = false;

  for (const publication of analytics.publications) {
    if (publication.status !== 'posted' || !publication.postedAt) {
      continue;
    }

    const postedTime = new Date(publication.postedAt).getTime();
    if (!Number.isFinite(postedTime)) {
      continue;
    }

    const snapshots = Array.isArray(publication.metricsSnapshots) ? publication.metricsSnapshots : [];
    for (const window of METRIC_REFRESH_WINDOWS) {
      if (snapshots.some((snapshot) => snapshot.label === window.label)) {
        continue;
      }

      if (Date.now() - postedTime < window.ageMs) {
        continue;
      }

      try {
        const metadata = await fetchPostMetadata(publication.postUrl);
        snapshots.push(buildMetricsSnapshot(metadata, window.label));
        publication.metricsSnapshots = snapshots;
        publication.title = publication.title || metadata.title || '';
        publication.lastMetricsRefreshAt = new Date().toISOString();
        changed = true;
        log(`Captured ${window.label} metrics for ${publication.postUrl}`);
      } catch (error) {
        log(`Could not refresh ${window.label} metrics for ${publication.postUrl}: ${error.message}`);
      }
    }
  }

  if (changed) {
    await writeAnalytics(analytics);
  }

  return analytics;
}

function buildWeeklyLearning(analytics) {
  const cutoff = Date.now() - WEEK_MS;
  const publications = analytics.publications.filter((publication) => {
    if (publication.status !== 'posted' || !publication.postedAt) return false;
    const postedTime = new Date(publication.postedAt).getTime();
    return Number.isFinite(postedTime) && postedTime >= cutoff;
  });

  const subredditStats = new Map();
  const hourStats = new Map();
  const termStats = new Map();
  const toneStats = {
    shortComments: { count: 0, engagement: 0 },
    linkAsAfterthought: { count: 0, engagement: 0 },
    questionComments: { count: 0, engagement: 0 },
  };

  for (const publication of publications) {
    const snapshot = latestSnapshot(publication);
    const engagement = engagementValue(snapshot);
    const subreddit = String(publication.subreddit || 'unknown').toLowerCase();
    const subredditStat = subredditStats.get(subreddit) || { subreddit, posts: 0, totalEngagement: 0 };
    subredditStat.posts += 1;
    subredditStat.totalEngagement += engagement;
    subredditStats.set(subreddit, subredditStat);

    const hour = new Date(publication.postedAt).getUTCHours();
    const hourStat = hourStats.get(hour) || { hourUtc: hour, posts: 0, totalEngagement: 0 };
    hourStat.posts += 1;
    hourStat.totalEngagement += engagement;
    hourStats.set(hour, hourStat);

    for (const term of tokenize(`${publication.title} ${publication.opportunityReason || ''}`)) {
      const termStat = termStats.get(term) || { term, posts: 0, totalEngagement: 0 };
      termStat.posts += 1;
      termStat.totalEngagement += engagement;
      termStats.set(term, termStat);
    }

    const commentText = String(publication.commentText || '');
    const wordCount = commentText.trim().split(/\s+/).filter(Boolean).length;
    const toneKeys = [
      wordCount <= 55 ? 'shortComments' : null,
      /\[[^\]]+\]\(https?:\/\//.test(commentText) && commentText.lastIndexOf('[') > commentText.length * 0.45 ? 'linkAsAfterthought' : null,
      commentText.includes('?') ? 'questionComments' : null,
    ].filter(Boolean);

    for (const key of toneKeys) {
      toneStats[key].count += 1;
      toneStats[key].engagement += engagement;
    }
  }

  const rank = (items) => items
    .map((item) => ({
      ...item,
      avgEngagement: item.posts ? Number((item.totalEngagement / item.posts).toFixed(2)) : 0,
    }))
    .sort((a, b) => b.avgEngagement - a.avgEngagement || b.posts - a.posts);

  const topSubreddits = rank([...subredditStats.values()]).slice(0, 5);
  const productiveHoursUtc = rank([...hourStats.values()]).slice(0, 5);
  const effectiveTerms = rank([...termStats.values()])
    .filter((item) => item.posts >= 1)
    .slice(0, 12);
  const effectiveTones = Object.entries(toneStats)
    .map(([tone, stat]) => ({
      tone,
      posts: stat.count,
      avgEngagement: stat.count ? Number((stat.engagement / stat.count).toFixed(2)) : 0,
    }))
    .filter((item) => item.posts > 0)
    .sort((a, b) => b.avgEngagement - a.avgEngagement);

  return {
    generatedAt: new Date().toISOString(),
    windowDays: 7,
    sampleSize: publications.length,
    topSubreddits,
    productiveHoursUtc,
    effectiveTerms,
    effectiveTones,
    searchQueries: effectiveTerms.slice(0, 6).map((item) => item.term),
  };
}

async function runWeeklyLearningAnalysis(force = false) {
  const analytics = await readAnalytics();
  const lastRun = analytics.lastWeeklyAnalysisAt ? new Date(analytics.lastWeeklyAnalysisAt).getTime() : 0;
  if (!force && Number.isFinite(lastRun) && Date.now() - lastRun < WEEK_MS) {
    return readLearning();
  }

  const learning = buildWeeklyLearning(analytics);
  if (learning.sampleSize === 0) {
    return readLearning();
  }

  analytics.lastWeeklyAnalysisAt = learning.generatedAt;
  await writeAnalytics(analytics);
  await writeLearning(learning);
  log(`Updated weekly learning from ${learning.sampleSize} posted item(s)`);
  return learning;
}

function isOlderThan48Hours(createdAtMs) {
  return !createdAtMs || Date.now() - createdAtMs > MAX_POST_AGE_MS;
}

function isUnavailableForComments(metadata) {
  return Boolean(metadata?.locked || metadata?.archived);
}

function unavailableReason(metadata) {
  if (metadata?.locked) return 'locked';
  if (metadata?.archived) return 'archived';
  return 'unavailable';
}

function isMissingCommentBoxFailure(details) {
  return String(details || '').includes('Could not find the Reddit comment box on the page');
}

function isLockedOrArchivedRestrictionFailure(details) {
  const text = String(details || '');
  return isMissingCommentBoxFailure(text) && /(Locked post|Archived post)/i.test(text);
}

export async function addToQueue(postUrl, commentText, subreddit, context = {}) {
  if (!postUrl || !commentText || !subreddit) {
    throw new Error('postUrl, commentText, and subreddit are required.');
  }

  if (isBlockedSubreddit(subreddit)) {
    log(`Skipping blocked subreddit r/${subreddit}: ${postUrl}`);
    return { success: false, postUrl, subreddit, blockedSubreddit: true };
  }

  if (await isBlockedPostUrl(postUrl)) {
    return { success: false, postUrl, subreddit, blocked: true };
  }

  const queue = await readQueue();
  if (queueHasPostUrl(queue, postUrl)) {
    log(`Skipping already known post: ${postUrl}`);
    return { success: false, postUrl, subreddit, duplicate: true };
  }

  let scheduledAt = nextScheduledAt(queue);
  
  // Gold opportunities are published immediately (next 2 minutes)
  if (isGoldOpportunity(context.comments || 0, context.score || 0)) {
    scheduledAt = new Date(Date.now() + randomBetween(30000, 120000)).toISOString();
    log(`🔥 GOLD OPPORTUNITY DETECTED: ${context.comments}+ comments, ${context.score}+ upvotes`);
  }
  
  const item = buildQueueItem(postUrl, commentText, subreddit, scheduledAt, context);

  queue.push(item);
  await writeQueue(queue);

  log(`Queued ${postUrl} for r/${subreddit} at ${scheduledAt}`);
  return { success: true, postUrl, subreddit, item };
}

async function enrichOpportunity(opportunity) {
  const postUrl = opportunity.reddit_url || opportunity.url;
  const commentText = opportunity.reply || opportunity.value_comment || opportunity.link_reply || '';

  if (!postUrl || !commentText) {
    throw new Error('Opportunity is missing postUrl or commentText.');
  }

  const metadata = await fetchPostMetadata(postUrl);
  return {
    postUrl,
    commentText,
    subreddit: metadata.subreddit || extractSubreddit(postUrl),
    createdAtMs: metadata.createdAtMs,
    title: metadata.title,
    reason: opportunity.reason || opportunity.opportunity || '',
    locked: metadata.locked,
    archived: metadata.archived,
    comments: metadata.comments,
    score: metadata.score,
  };
}

async function markQueueItem(queue, itemId, status, postedAt = null) {
  const item = queue.find((entry) => entry.id === itemId);
  if (!item) return queue;

  item.status = status;
  item.postedAt = postedAt;
  await writeQueue(queue);
  return queue;
}

async function processQueue() {
  await refreshTrackedMetrics();
  await runWeeklyLearningAnalysis();

  const queue = await readQueue();
  let postedToday = countPostedToday(queue);
  const now = Date.now();
  const pendingItems = queue
    .filter((item) => {
      if (item.status !== 'pending') return false;
      const scheduledTime = new Date(item.scheduledAt).getTime();
      return Number.isFinite(scheduledTime) && scheduledTime <= now;
    })
    .sort((a, b) => {
      // High priority items first, then by scheduled time
      if (a.priority === 'high' && b.priority !== 'high') return -1;
      if (a.priority !== 'high' && b.priority === 'high') return 1;
      return new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime();
    });

  if (!pendingItems.length) {
    const futurePendingCount = queue.filter((item) => {
      if (item.status !== 'pending') return false;
      const scheduledTime = new Date(item.scheduledAt).getTime();
      return Number.isFinite(scheduledTime) && scheduledTime > now;
    }).length;

    if (futurePendingCount > 0) {
      log(`No due queue items to process. ${futurePendingCount} pending item(s) scheduled for later.`);
    } else {
      log('No pending queue items to process');
    }
    return queue;
  }

  for (const item of pendingItems) {
    if (postedToday >= MAX_POSTS_PER_DAY) {
      log(`Daily posting cap reached (${MAX_POSTS_PER_DAY}). Leaving remaining items pending.`);
      break;
    }

    const MAX_POSTS_PER_SUBREDDIT_PER_DAY = 2;
    if (isBlockedSubreddit(item.subreddit)) {
      log(`Skipping ${item.postUrl} because r/${item.subreddit} is blocked`);
      await markQueueItem(queue, item.id, 'failed');
      continue;
    }

    const postedCountForSubreddit = countPostedTodayForSubreddit(queue, item.subreddit);
    
    if (postedCountForSubreddit >= MAX_POSTS_PER_SUBREDDIT_PER_DAY) {
      log(`Skipping ${item.postUrl} because r/${item.subreddit} already has ${postedCountForSubreddit} post(s) today`);
      await markQueueItem(queue, item.id, 'failed');
      continue;
    }

    let metadata;
    try {
      metadata = await fetchPostMetadata(item.postUrl);
    } catch (error) {
      log(`Failed to refresh metadata for ${item.postUrl}: ${error.message}`);
      await markQueueItem(queue, item.id, 'failed');
      continue;
    }

    if (isOlderThan48Hours(metadata.createdAtMs)) {
      log(`Skipping ${item.postUrl} because it is older than 48 hours`);
      await markQueueItem(queue, item.id, 'failed');
      continue;
    }

    if (isUnavailableForComments(metadata)) {
      log(`Skipping ${item.postUrl} because the post is ${unavailableReason(metadata)}`);
      await blockPostUrl(item.postUrl);
      await markQueueItem(queue, item.id, 'failed');
      continue;
    }

    log(`Posting queued comment to ${item.postUrl}`);
    try {
      const result = await postComment(item.postUrl, item.commentText);

      if (result.success) {
        const postedAt = new Date().toISOString();
        await markQueueItem(queue, item.id, 'posted', postedAt);
        await recordPublication(item, 'posted', { postedAt, metadata });
        await blockPostUrl(item.postUrl);
        postedToday += 1;
        log(`Posted successfully to r/${item.subreddit} at ${postedAt}`);
        continue;
      }

      if (isLockedOrArchivedRestrictionFailure(result.details)) {
        await blockPostUrl(item.postUrl);
      }

      await markQueueItem(queue, item.id, 'failed');
      await recordPublication(item, 'failed', { failureDetails: result.details, metadata });
      log(`Posting failed for ${item.postUrl}${result.details ? `: ${result.details}` : ''}`);
    } catch (error) {
      if (isLockedOrArchivedRestrictionFailure(error.message)) {
        await blockPostUrl(item.postUrl);
      }

      await markQueueItem(queue, item.id, 'failed');
      await recordPublication(item, 'failed', { failureDetails: error.message, metadata });
      log(`Posting error for ${item.postUrl}: ${error.message}`);
      if (error.stack) {
        log(`Stack trace: ${error.stack}`);
      }
    }
  }

  return readQueue();
}

export async function getQueueStatus() {
  return readQueue();
}

async function syncQueueToRailway() {
  log('Syncing existing queue items to Railway');
  
  const RAILWAY_URL = 'https://redditauth2-production.up.railway.app/api/queue/add';
  const queue = await readQueue();
  const pendingItems = queue.filter((item) => item.status === 'pending');
  
  if (pendingItems.length === 0) {
    log('No pending items to sync');
    return;
  }
  
  log(`Found ${pendingItems.length} pending items to sync to Railway`);
  
  for (const item of pendingItems) {
    try {
      const response = await fetch(RAILWAY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          postUrl: item.postUrl,
          commentText: item.commentText,
          subreddit: item.subreddit
        })
      });

      if (response.ok) {
        log(`Synced to Railway: ${item.postUrl} for r/${item.subreddit}`);
      } else {
        log(`Railway sync failed (${response.status}): ${item.postUrl}`);
      }
    } catch (error) {
      log(`Railway sync error for ${item.postUrl}: ${error.message}`);
    }
  }
  
  log(`Finished syncing ${pendingItems.length} items to Railway`);
}

async function fillDailyQueue(maxAttempts = 5) {
  try {
    let attempt = 0;
    let activeCount = countActiveToday(await readQueue());
    let consecutiveEmptyAttempts = 0;
    
    while (attempt < maxAttempts && activeCount < MAX_POSTS_PER_DAY) {
      attempt += 1;
      log(`Research attempt ${attempt}/${maxAttempts}`);
      
      const queueBeforeResearch = await readQueue();
      const blockedPostUrls = await readBlockedPosts();
      const publishedPostUrls = await getPublishedPostUrls();
      const knownPostUrls = [...getQueuePostUrls(queueBeforeResearch), ...blockedPostUrls, ...publishedPostUrls];
      const learning = await readLearning();
      const opportunities = await runResearch({ knownPostUrls, learning });
      log(`Selected ${opportunities.length} opportunities from research`);
      
      if (opportunities.length === 0) {
        consecutiveEmptyAttempts += 1;
        if (consecutiveEmptyAttempts >= 3) {
          log(`No opportunities found in 3 consecutive attempts. Abandoning research and pushing what we have...`);
          break;
        }
      } else {
        consecutiveEmptyAttempts = 0;
      }
      
      for (const opportunity of opportunities) {
        if (activeCount >= MAX_POSTS_PER_DAY) {
          log(`Queue limit reached (${MAX_POSTS_PER_DAY}). Not adding more opportunities today.`);
          break;
        }

        try {
          const postUrl = opportunity.reddit_url || opportunity.url;
          if (isBlockedSubreddit(extractSubreddit(postUrl))) {
            log(`Skipping opportunity from blocked subreddit: ${postUrl}`);
            continue;
          }

          if (await isBlockedPostUrl(postUrl)) {
            continue;
          }

          if (queueHasPostUrl(await readQueue(), postUrl)) {
            log(`Skipping already known post: ${postUrl}`);
            continue;
          }

          const enriched = await enrichOpportunity(opportunity);
          if (isOlderThan48Hours(enriched.createdAtMs)) {
            log(`Skipping ${enriched.postUrl} because the post is older than 48 hours`);
            continue;
          }

          if (isUnavailableForComments(enriched)) {
            log(`Skipping ${enriched.postUrl} because the post is ${unavailableReason(enriched)}`);
            await blockPostUrl(enriched.postUrl);
            continue;
          }

          const result = await addToQueue(enriched.postUrl, enriched.commentText, enriched.subreddit, {
            title: enriched.title,
            reason: enriched.reason,
            comments: enriched.comments,
            score: enriched.score,
          });
          if (result.success) {
            activeCount = countActiveToday(await readQueue());
          }
        } catch (error) {
          log(`Could not queue an opportunity: ${error.message}`);
        }
      }
      
      const queue = await readQueue();
      activeCount = countActiveToday(queue);
      log(`Current active items for today: ${activeCount}`);
      
      if (activeCount < MAX_POSTS_PER_DAY && attempt < maxAttempts) {
        log(`Only ${activeCount} active items (need ${MAX_POSTS_PER_DAY}). Retrying in 30 seconds...`);
        await sleep(30000);
      }
    }
  } catch (err) {
    log(`Research phase failed: ${err.message}. Continuing...`);
  }
}

export async function runDailyJob() {
  log('Starting daily Reddit automation job');
  
  // Sync any existing local queue items to Railway before clearing the daily work queue.
  await syncQueueToRailway();
  
  await writeQueue([]);
  log('Cleared all queue items. Starting fresh.');
  
  // Fill the day before posting, then refill if an immediate post fails.
  await fillDailyQueue(5);
  
  const currentQueue = await processQueue();

  if (countActiveToday(currentQueue) < MAX_POSTS_PER_DAY) {
    log(`Daily queue has ${countActiveToday(currentQueue)} active item(s) after posting. Looking for replacements...`);
    await fillDailyQueue(2);
  }

  log('Daily Reddit automation job finished');
  return readQueue();
}

function scheduleDailyJob() {
  const nextRun = nextDailyJobDate();
  const delayMs = nextRun.getTime() - Date.now();

  log(`Next daily Reddit automation job scheduled for ${nextRun.toISOString()}`);

  setTimeout(async () => {
    if (dailyJobRunning) {
      log('Daily job already running. Skipping and rescheduling...');
      scheduleDailyJob();
      return;
    }

    dailyJobRunning = true;
    try {
      await runDailyJob();
    } catch (error) {
      log(`Daily Reddit automation job failed: ${error.message}`);
    } finally {
      dailyJobRunning = false;
      scheduleDailyJob();
    }
  }, delayMs);
}

function startQueueProcessor() {
  const runProcessor = async () => {
    if (queueProcessorRunning) {
      log('Queue processor already running. Skipping this tick.');
      return;
    }

    queueProcessorRunning = true;
    try {
      await processQueue();
    } catch (error) {
      log(`Queue processor failed: ${error.message}`);
    } finally {
      queueProcessorRunning = false;
    }
  };

  runProcessor();
  setInterval(runProcessor, QUEUE_PROCESS_INTERVAL_MS);
}

function startScheduler() {
  log('Starting automatic Reddit queue scheduler');
  startQueueProcessor();
  scheduleDailyJob();
}

async function main() {
  const command = process.argv[2];

  if (command === 'schedule') {
    startScheduler();
    return;
  }

  if (command === 'run') {
    const queue = await runDailyJob();
    console.log(queue);
    return;
  }

  if (command === 'status') {
    const queue = await getQueueStatus();
    console.log(queue);
    return;
  }

  if (command === 'add') {
    const postUrl = process.argv[3];
    const commentText = process.argv[4];
    const subreddit = process.argv[5];

    if (!postUrl || !commentText || !subreddit) {
      console.error('[reddit-queue] Usage: node reddit-queue.mjs add <postUrl> <commentText> <subreddit>');
      process.exit(1);
    }

    const item = await addToQueue(postUrl, commentText, subreddit);
    console.log(item);
    return;
  }

  console.error('[reddit-queue] Usage: node reddit-queue.mjs <schedule|run|status|add>');
  process.exit(1);
}

const currentFilePath = fileURLToPath(import.meta.url);
const entryFilePath = process.argv[1] ? path.resolve(process.argv[1]) : '';

if (currentFilePath === entryFilePath) {
  main().catch((error) => {
    console.error(`[reddit-queue] ${error.message}`);
    process.exit(1);
  });
}
