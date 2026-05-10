import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { postComment } from './reddit-poster.mjs';

const QUEUE_FILE = path.resolve(process.cwd(), 'queue.json');
const SESSION_FILE = path.resolve(process.cwd(), 'reddit_session.json');
const RESULTS_STORAGE_KEY = 'redditauth.lastResults';
const RESEARCH_APP_URLS = [
  process.env.REDDITAUTH_APP_URL || 'http://127.0.0.1:8081/',
  'http://127.0.0.1:8000/',
];
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

async function readSessionCookies(sessionFile = SESSION_FILE) {
  if (process.env.REDDIT_SESSION) {
    return JSON.parse(process.env.REDDIT_SESSION);
  }

  const raw = await readFile(sessionFile, 'utf8');
  const parsed = JSON.parse(raw);
  const cookies = Array.isArray(parsed) ? parsed : parsed?.cookies;

  if (!Array.isArray(cookies) || cookies.length === 0) {
    throw new Error(`Session file is empty or invalid: ${sessionFile}`);
  }

  return cookies;
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

function startResearchServer() {
  const serverProcess = spawn('python', ['serve_static.py'], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  serverProcess.stdout.on('data', (chunk) => {
    log(`serve_static.py: ${chunk.toString().trim()}`);
  });

  serverProcess.stderr.on('data', (chunk) => {
    log(`serve_static.py error: ${chunk.toString().trim()}`);
  });

  return serverProcess;
}

async function waitForServer(urls, timeoutMs = 15000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    for (const url of urls) {
      try {
        const response = await fetch(url, { method: 'GET' });
        if (response.ok) {
          return url;
        }
      } catch {
        // Keep polling until one URL is ready.
      }
    }

    await sleep(500);
  }

  throw new Error(`Research server did not become ready within ${timeoutMs / 1000} seconds.`);
}

async function stopResearchServer(serverProcess) {
  if (!serverProcess || serverProcess.killed) {
    return;
  }

  serverProcess.kill();
  await new Promise((resolve) => {
    serverProcess.once('exit', resolve);
    setTimeout(resolve, 3000);
  });
}

async function isPortResponding(port = 8000, timeoutMs = 2000) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/`, { method: 'GET', signal: AbortSignal.timeout(timeoutMs) });
    return response.ok;
  } catch {
    return false;
  }
}

async function runResearchModule() {
  const portReady = await isPortResponding();
  const serverProcess = portReady ? null : startResearchServer();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  try {
    const researchUrl = await waitForServer(RESEARCH_APP_URLS);
    let cookies = JSON.parse(process.env.REDDIT_SESSION || '[]');
    if (!Array.isArray(cookies)) {
      cookies = cookies.cookies || [];
    }

    await context.addCookies(cookies);
    log(`Opening research app at ${researchUrl}`);
    await page.goto(researchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.locator('#scanButton').click({ timeout: 10000 });
    log('Research scan started');

    await page.waitForFunction(
      ({ storageKey }) => {
        const value = localStorage.getItem(storageKey);
        const errorText = document.querySelector('#errorMessage')?.textContent || '';
        const emptyVisible = document.querySelector('#emptyState')?.hidden === false;
        return Boolean(value) || Boolean(errorText) || emptyVisible;
      },
      { storageKey: RESULTS_STORAGE_KEY },
      { timeout: 180000 }
    );

    const result = await page.evaluate(({ storageKey }) => {
      const stored = localStorage.getItem(storageKey);
      const errorText = document.querySelector('#errorMessage')?.textContent || '';
      const emptyVisible = document.querySelector('#emptyState')?.hidden === false;
      const statusText = document.querySelector('#statusText')?.textContent || '';
      return {
        stored,
        errorText,
        emptyVisible,
        statusText,
      };
    }, { storageKey: RESULTS_STORAGE_KEY });

    if (result.errorText) {
      throw new Error(`Research module reported an error: ${result.errorText}`);
    }

    if (result.emptyVisible && !result.stored) {
      log('Research returned no opportunities');
      return [];
    }

    const parsed = JSON.parse(result.stored || '[]');
    if (!Array.isArray(parsed)) {
      throw new Error('Research module returned an invalid results payload.');
    }

    log(`Research completed with ${parsed.length} opportunities`);
    return parsed.slice(0, 4);
  } catch (error) {
    throw new Error(
      `Unable to run the existing research flow in the browser. ${error.message}`
    );
  } finally {
    await browser.close();
    if (serverProcess) {
      await stopResearchServer(serverProcess);
    }
  }
}

export async function addToQueue(postUrl, commentText, subreddit) {
  if (!postUrl || !commentText || !subreddit) {
    throw new Error('postUrl, commentText, and subreddit are required.');
  }

  const queue = await readQueue();
  const baseTime = nextScheduleBase(queue);
  const scheduledAt = new Date(baseTime + randomBetween(MIN_DELAY_MS, MAX_DELAY_MS)).toISOString();
  const item = buildQueueItem(postUrl, commentText, subreddit, scheduledAt);

  queue.push(item);
  await writeQueue(queue);
  log(`Queued ${item.postUrl} for r/${item.subreddit} at ${item.scheduledAt}`);
  return item;
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
  }

  return readQueue();
}

export async function getQueueStatus() {
  return readQueue();
}

export async function runDailyJob() {
  log('Starting daily Reddit automation job');
  const opportunities = await runResearchModule();

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

  const queue = await processQueue();
  log('Daily Reddit automation job finished');
  return queue;
}

function nextRandomRunTime(from = new Date()) {
  const next = new Date(from);
  next.setSeconds(0, 0);

  const hour = next.getHours();
  const minute = next.getMinutes();
  const inWindow = hour >= 9 && (hour < 11 || (hour === 11 && minute === 0));

  if (!inWindow) {
    if (hour >= 11) {
      next.setDate(next.getDate() + 1);
    }
    next.setHours(9, 0, 0, 0);
  }

  const offsetMinutes = randomBetween(0, 120);
  next.setMinutes(next.getMinutes() + offsetMinutes);

  if (next <= from) {
    next.setDate(next.getDate() + 1);
    next.setHours(9, 0, 0, 0);
    next.setMinutes(next.getMinutes() + randomBetween(0, 120));
  }

  return next;
}

function scheduleDailyJob() {
  const nextRun = nextRandomRunTime();
  const delayMs = nextRun.getTime() - Date.now();

  log(`Next automatic daily job scheduled for ${nextRun.toISOString()}`);

  setTimeout(async () => {
    try {
      await runDailyJob();
    } catch (error) {
      log(`Scheduled daily job failed: ${error.message}`);
    } finally {
      scheduleDailyJob();
    }
  }, delayMs);
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

  log('Starting scheduler mode');
  scheduleDailyJob();
}

const currentFilePath = fileURLToPath(import.meta.url);
const entryFilePath = process.argv[1] ? path.resolve(process.argv[1]) : '';

if (currentFilePath === entryFilePath) {
  main().catch((error) => {
    console.error(`[reddit-queue] ${error.message}`);
    process.exit(1);
  });
}
