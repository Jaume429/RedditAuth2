import { chromium } from 'playwright';
import { writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const REDDIT_URL = 'https://www.reddit.com';
const SESSION_FILE = path.resolve(process.cwd(), 'reddit_session.json');

function buildStorageState(cookies) {
  return {
    cookies,
    origins: [],
  };
}

async function readSessionCookies(sessionFile = SESSION_FILE) {
  if (process.env.REDDIT_SESSION) {
    const sessionData = JSON.parse(process.env.REDDIT_SESSION);
    const cookies = Array.isArray(sessionData) ? sessionData : (sessionData.cookies || []);
    return cookies;
  }

  const raw = await readFile(sessionFile, 'utf8');
  const parsed = JSON.parse(raw);
  const cookies = Array.isArray(parsed) ? parsed : parsed?.cookies;

  if (!Array.isArray(cookies) || cookies.length === 0) {
    throw new Error(`Session file is empty or invalid: ${sessionFile}`);
  }

  return cookies;
}

export async function saveRedditSession(sessionFile = SESSION_FILE) {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  const rl = readline.createInterface({ input, output });

  try {
    await page.goto(`${REDDIT_URL}/login/`, { waitUntil: 'domcontentloaded' });

    console.log('Log in to Reddit in the opened browser window.');
    console.log('When you are fully logged in, press Enter here to save cookies.');
    await rl.question('');

    const cookies = await context.cookies();

    if (cookies.length === 0) {
      throw new Error('No cookies were found. Make sure you completed the Reddit login first.');
    }

    await writeFile(sessionFile, JSON.stringify(buildStorageState(cookies), null, 2), 'utf8');
    console.log(`Reddit session saved to ${sessionFile}`);
  } finally {
    rl.close();
    await browser.close();
  }
}

export async function verifyRedditSession(sessionFile = SESSION_FILE) {
  let cookies;

  try {
    cookies = await readSessionCookies(sessionFile);
    console.log('Loaded cookies from session file:');
    console.log(
      cookies.map((cookie) => ({
        name: cookie.name,
        domain: cookie.domain,
        path: cookie.path,
        expires: cookie.expires,
        httpOnly: cookie.httpOnly,
        secure: cookie.secure,
        sameSite: cookie.sameSite,
      }))
    );
  } catch (error) {
    console.error(`Reddit session missing or unreadable. Re-run the login script. ${error.message}`);
    return false;
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  try {
    await context.addCookies(cookies);
    await page.goto(REDDIT_URL, { waitUntil: 'domcontentloaded' });
    const response = await context.request.get(`${REDDIT_URL}/api/me.json`, {
      headers: {
        accept: 'application/json',
        referer: `${REDDIT_URL}/`,
      },
    });

    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }

    console.log('Response from reddit.com/api/me.json:');
    console.log({
      ok: response.ok(),
      status: response.status(),
      statusText: response.statusText(),
      url: response.url(),
    });
    console.log('Parsed JSON from reddit.com/api/me.json:');
    console.log(data);

    if (!response.ok()) {
      console.error('Reddit session is invalid or expired. Re-run the login script.');
      return false;
    }

    const username = data?.name ?? data?.data?.name;

    if (!username) {
      console.error('Reddit session is invalid or expired. Re-run the login script.');
      return false;
    }

    console.log(`Reddit session is valid for u/${username}`);
    return true;
  } catch (error) {
    console.error(`Could not verify Reddit session. Re-run the login script. ${error.message}`);
    return false;
  } finally {
    await browser.close();
  }
}

async function main() {
  const command = process.argv[2];

  if (command === 'login') {
    await saveRedditSession();
    return;
  }

  if (command === 'verify') {
    const isValid = await verifyRedditSession();
    process.exitCode = isValid ? 0 : 1;
    return;
  }

  console.log('Usage:');
  console.log('  node reddit-session.mjs login');
  console.log('  node reddit-session.mjs verify');
}

const currentFilePath = fileURLToPath(import.meta.url);
const entryFilePath = process.argv[1] ? path.resolve(process.argv[1]) : '';

if (currentFilePath === entryFilePath) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
