import { readFile, writeFile } from 'node:fs/promises';
import { request as httpsRequest } from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { postComment } from './reddit-poster.mjs';
import { runResearch } from './research-node.mjs';

const QUEUE_FILE = path.resolve(process.cwd(), 'queue.json');
const BLOCKED_POSTS_FILE = path.resolve(process.cwd(), 'blocked-posts.json');
const PROXY_URL = 'http://aaubcdkx-es-8:ecljgj60smyr@p.webshare.io:80';
const MIN_DELAY_MS = 2 * 60 * 60 * 1000;
const MAX_DELAY_MS = 3 * 60 * 60 * 1000;
const MAX_POSTS_PER_DAY = 4;
const MAX_POST_AGE_MS = 48 * 60 * 60 * 1000;
const DAILY_JOB_HOUR_UTC = 7;
const QUEUE_PROCESS_INTERVAL_MS = 10 * 60 * 1000;
let queueProcessorRunning = false;

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

function normalizeQueue(queue) {
  return Array.isArray(queue) ? queue : [];
}

function normalizeBlockedPosts(blockedPosts) {
  return Array.isArray(blockedPosts) ? blockedPosts : [];
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

function buildQueueItem(postUrl, commentText, subreddit, scheduledAt) {
  return {
    id: `queue_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    postUrl,
    commentText,
    subreddit,
    status: 'pending',
    scheduledAt,
    postedAt: null,
  };
}

function countPostedToday(queue) {
  return queue.filter((item) => item.status === 'posted' && isSameDay(item.postedAt)).length;
}

function countPendingToday(queue) {
  return queue.filter((item) => item.status === 'pending' && isSameDay(item.scheduledAt)).length;
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
  };
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

export async function addToQueue(postUrl, commentText, subreddit) {
  if (!postUrl || !commentText || !subreddit) {
    throw new Error('postUrl, commentText, and subreddit are required.');
  }

  if (await isBlockedPostUrl(postUrl)) {
    return { success: false, postUrl, subreddit, blocked: true };
  }

  const queue = await readQueue();
  if (queueHasPostUrl(queue, postUrl)) {
    log(`Skipping already known post: ${postUrl}`);
    return { success: false, postUrl, subreddit, duplicate: true };
  }

  const scheduledAt = nextScheduledAt(queue);
  const item = buildQueueItem(postUrl, commentText, subreddit, scheduledAt);

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
    locked: metadata.locked,
    archived: metadata.archived,
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
  const queue = await readQueue();
  let postedToday = countPostedToday(queue);
  const now = Date.now();
  const pendingItems = queue
    .filter((item) => {
      if (item.status !== 'pending') return false;
      const scheduledTime = new Date(item.scheduledAt).getTime();
      return Number.isFinite(scheduledTime) && scheduledTime <= now;
    })
    .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());

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
        await blockPostUrl(item.postUrl);
        postedToday += 1;
        log(`Posted successfully to r/${item.subreddit} at ${postedAt}`);
        continue;
      }

      if (isLockedOrArchivedRestrictionFailure(result.details)) {
        await blockPostUrl(item.postUrl);
      }

      await markQueueItem(queue, item.id, 'failed');
      log(`Posting failed for ${item.postUrl}${result.details ? `: ${result.details}` : ''}`);
    } catch (error) {
      if (isLockedOrArchivedRestrictionFailure(error.message)) {
        await blockPostUrl(item.postUrl);
      }

      await markQueueItem(queue, item.id, 'failed');
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

export async function runDailyJob() {
  log('Starting daily Reddit automation job');
  
  // Sync any existing local queue items to Railway before clearing the daily work queue.
  await syncQueueToRailway();
  
  await writeQueue([]);
  log('Cleared all queue items. Starting fresh.');
  
  // Run research up to 5 times, with 30-second delays, until we have 4 pending items for today
  try {
    const MAX_RESEARCH_ATTEMPTS = 5;
    let attempt = 0;
    let pendingCount = countPendingToday(await readQueue());
    
    while (attempt < MAX_RESEARCH_ATTEMPTS && pendingCount < MAX_POSTS_PER_DAY) {
      attempt += 1;
      log(`Research attempt ${attempt}/${MAX_RESEARCH_ATTEMPTS}`);
      
      const queueBeforeResearch = await readQueue();
      const blockedPostUrls = await readBlockedPosts();
      const knownPostUrls = [...getQueuePostUrls(queueBeforeResearch), ...blockedPostUrls];
      const opportunities = await runResearch({ knownPostUrls });
      log(`Selected ${opportunities.length} opportunities from research`);
      
      for (const opportunity of opportunities) {
        if (pendingCount >= MAX_POSTS_PER_DAY) {
          log(`Queue limit reached (${MAX_POSTS_PER_DAY}). Not adding more opportunities today.`);
          break;
        }

        try {
          const postUrl = opportunity.reddit_url || opportunity.url;
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

          const result = await addToQueue(enriched.postUrl, enriched.commentText, enriched.subreddit);
          if (result.success) {
            pendingCount = countPendingToday(await readQueue());
          }
        } catch (error) {
          log(`Could not queue an opportunity: ${error.message}`);
        }
      }
      
      const queue = await readQueue();
      pendingCount = countPendingToday(queue);
      log(`Current pending items for today: ${pendingCount}`);
      
      if (pendingCount < MAX_POSTS_PER_DAY && attempt < MAX_RESEARCH_ATTEMPTS) {
        log(`Only ${pendingCount} pending items (need ${MAX_POSTS_PER_DAY}). Retrying in 30 seconds...`);
        await sleep(30000);
      }
    }
  } catch (err) {
    log(`Research phase failed: ${err.message}. Continuing to posting phase...`);
  }
  
  const currentQueue = await processQueue();
  log('Daily Reddit automation job finished');
  return currentQueue;
}

function scheduleDailyJob() {
  const nextRun = nextDailyJobDate();
  const delayMs = nextRun.getTime() - Date.now();

  log(`Next daily Reddit automation job scheduled for ${nextRun.toISOString()}`);

  setTimeout(async () => {
    try {
      await runDailyJob();
    } catch (error) {
      log(`Daily Reddit automation job failed: ${error.message}`);
    } finally {
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
