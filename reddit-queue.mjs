import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { postComment } from './reddit-poster.mjs';
import { runResearch } from './research-node.mjs';

const QUEUE_FILE = path.resolve(process.cwd(), 'queue.json');
const MIN_DELAY_MS = 45 * 60 * 1000;
const MAX_DELAY_MS = 90 * 60 * 1000;
const MAX_POSTS_PER_DAY = 4;
const MAX_POST_AGE_MS = 48 * 60 * 60 * 1000;

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

function postedTodayForSubreddit(queue, subreddit) {
  return queue.some(
    (item) =>
      item.status === 'posted' &&
      item.subreddit.toLowerCase() === subreddit.toLowerCase() &&
      isSameDay(item.postedAt)
  );
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

function appendJsonSuffix(postUrl) {
  const url = new URL(postUrl);
  const cleanPath = url.pathname.replace(/\/$/, '');
  url.pathname = `${cleanPath}.json`;
  url.search = 'raw_json=1';
  return url.toString();
}

async function fetchPostMetadata(postUrl) {
  const response = await fetch(appendJsonSuffix(postUrl), {
    headers: {
      'User-Agent': 'RedditAuthQueue/1.0',
      accept: 'application/json',
    },
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
  };
}

function isOlderThan48Hours(createdAtMs) {
  return !createdAtMs || Date.now() - createdAtMs > MAX_POST_AGE_MS;
}

export async function addToQueue(postUrl, commentText, subreddit) {
  if (!postUrl || !commentText || !subreddit) {
    throw new Error('postUrl, commentText, and subreddit are required.');
  }

  const RAILWAY_URL = 'https://redditauth2-production.up.railway.app/api/queue/add';

  try {
    const response = await fetch(RAILWAY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ postUrl, commentText, subreddit })
    });

    if (response.ok) {
      log(`Posted to Railway: ${postUrl} for r/${subreddit}`);
      return { success: true, postUrl, subreddit };
    } else {
      log(`Railway POST failed (${response.status}): ${postUrl}`);
      return { success: false, postUrl, subreddit };
    }
  } catch (error) {
    log(`Railway POST error: ${error.message}`);
    return { success: false, postUrl, subreddit, error: error.message };
  }
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
  const pendingItems = queue
    .filter((item) => item.status === 'pending')
    .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());

  if (!pendingItems.length) {
    log('No pending queue items to process');
    return queue;
  }

  for (const item of pendingItems) {
    if (postedToday >= MAX_POSTS_PER_DAY) {
      log(`Daily posting cap reached (${MAX_POSTS_PER_DAY}). Leaving remaining items pending.`);
      break;
    }

    if (postedTodayForSubreddit(queue, item.subreddit)) {
      log(`Skipping ${item.postUrl} because r/${item.subreddit} already has a post today`);
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

    const scheduledTime = new Date(item.scheduledAt).getTime();
    const waitMs = scheduledTime - Date.now();
    if (waitMs > 0) {
      log(`Waiting ${(waitMs / 60000).toFixed(1)} minutes before posting ${item.postUrl}`);
      await sleep(waitMs);
    }

    log(`Posting queued comment to ${item.postUrl}`);
    try {
      const result = await postComment(item.postUrl, item.commentText);

      if (result.success) {
        const postedAt = new Date().toISOString();
        await markQueueItem(queue, item.id, 'posted', postedAt);
        postedToday += 1;
        log(`Posted successfully to r/${item.subreddit} at ${postedAt}`);
        continue;
      }

      await markQueueItem(queue, item.id, 'failed');
      log(`Posting failed for ${item.postUrl}${result.details ? `: ${result.details}` : ''}`);
    } catch (error) {
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
  
  // Clear all items not scheduled for today's UTC date to start fresh
  let queue = await readQueue();
  const itemsBeforeClear = queue.length;
  queue = queue.filter((item) => isTodayUtcDate(item.scheduledAt));
  const itemsCleared = itemsBeforeClear - queue.length;
  if (itemsCleared > 0) {
    await writeQueue(queue);
    log(`Cleared ${itemsCleared} items not scheduled for today's UTC date. Starting fresh.`);
  }
  
  // Sync any existing local queue items to Railway first
  await syncQueueToRailway();
  
  // Run research up to 5 times, with 30-second delays, until we have 4 pending items for today
  try {
    const MAX_RESEARCH_ATTEMPTS = 5;
    let attempt = 0;
    let pendingCount = 0;
    
    while (attempt < MAX_RESEARCH_ATTEMPTS && pendingCount < 4) {
      attempt += 1;
      log(`Research attempt ${attempt}/${MAX_RESEARCH_ATTEMPTS}`);
      
      const opportunities = await runResearch();
      log(`Selected ${opportunities.length} opportunities from research`);
      
      for (const opportunity of opportunities) {
        try {
          const enriched = await enrichOpportunity(opportunity);
          if (isOlderThan48Hours(enriched.createdAtMs)) {
            log(`Skipping ${enriched.postUrl} because the post is older than 48 hours`);
            continue;
          }

          await addToQueue(enriched.postUrl, enriched.commentText, enriched.subreddit);
        } catch (error) {
          log(`Could not queue an opportunity: ${error.message}`);
        }
      }
      
      const queue = await readQueue();
      pendingCount = countPendingToday(queue);
      log(`Current pending items for today: ${pendingCount}`);
      
      if (pendingCount < 4 && attempt < MAX_RESEARCH_ATTEMPTS) {
        log(`Only ${pendingCount} pending items (need 4). Retrying in 30 seconds...`);
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

async function main() {
  const command = process.argv[2];

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

  console.error('[reddit-queue] Usage: node reddit-queue.mjs <run|status|add>');
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
