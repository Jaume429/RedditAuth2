import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyRedditSession } from './reddit-session.mjs';

const POST_COMMENT_TIMEOUT_MS = 120000;
const DEBUG_REDDIT_POSTER = process.env.DEBUG_REDDIT_POSTER === '1';
const DEBUG_ARTIFACTS_DIR = path.resolve(process.cwd(), 'debug-artifacts');
const REDDIT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';

function buildResult(success, postUrl, commentText, details = null) {
  return {
    success,
    timestamp: new Date().toISOString(),
    postUrl,
    commentPreview: commentText.slice(0, 50),
    details,
  };
}

async function readSessionCookies() {
  const raw = process.env.REDDIT_SESSION;
  if (!raw) {
    throw new Error('REDDIT_SESSION environment variable is not set');
  }
  const parsed = JSON.parse(raw);
  const cookies = Array.isArray(parsed) ? parsed : parsed?.cookies;

  if (!Array.isArray(cookies) || cookies.length === 0) {
    throw new Error('Session is empty or invalid');
  }

  return cookies;
}

async function scrollToCommentSection(page) {
  const commentSectionSelectors = [
    'shreddit-comment-tree',
    '[data-testid="comment-tree"]',
    '#comment-tree',
    'faceplate-partial[loading="action"]',
  ];

  for (const selector of commentSectionSelectors) {
    const section = page.locator(selector).first();
    if (await section.count()) {
      try {
        await section.scrollIntoViewIfNeeded({ timeout: 5000 });
        return;
      } catch {
        continue;
      }
    }
  }

  await page.mouse.wheel(0, 900);
}

async function waitForRedditRender(page) {
  const renderSelectors = [
    'shreddit-post',
    'shreddit-comment-tree',
    '[data-testid="post-container"]',
    '[data-testid="comment-tree"]',
    'div[contenteditable="true"][role="textbox"]',
    'textarea[name="comment"]',
  ];

  await Promise.race([
    Promise.any(
      renderSelectors.map((selector) =>
        page.locator(selector).first().waitFor({ state: 'attached', timeout: 5000 })
      )
    ).catch(() => null),
    page.waitForTimeout(5000),
  ]);
}

function toOldRedditUrl(postUrl) {
  const url = new URL(postUrl);
  url.protocol = 'https:';
  url.hostname = 'old.reddit.com';
  return url.toString();
}

async function detectOldRedditRestriction(page) {
  const restrictionChecks = [
    { label: 'Locked post', selector: '.locked-infobar, .reddit-infobar:has-text("locked"), .error:has-text("locked")' },
    { label: 'Archived post', selector: '.archived-infobar, .reddit-infobar:has-text("archived"), .error:has-text("archived")' },
    { label: 'Login required', selector: 'a.login-required, .error:has-text("log in to leave a comment"), .error:has-text("you must log in")' },
    { label: 'Quarantined or unavailable post', selector: '.interstitial, .error:has-text("quarantined"), .error:has-text("unavailable")' },
  ];

  for (const check of restrictionChecks) {
    const locator = page.locator(check.selector).first();
    if (await locator.count().catch(() => 0)) {
      try {
        await locator.waitFor({ state: 'visible', timeout: 1000 });
        return check.label;
      } catch {
        return check.label;
      }
    }
  }

  return null;
}

async function findOldRedditCommentInput(page) {
  const inputSelectors = [
    'form.usertext textarea[name="text"]',
    '.usertext-edit textarea[name="text"]',
    'textarea[name="text"]',
    'textarea',
  ];

  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    for (const selector of inputSelectors) {
      const locator = page.locator(selector).first();
      if (await locator.count()) {
        try {
          await locator.scrollIntoViewIfNeeded({ timeout: 3000 });
          await locator.waitFor({ state: 'visible', timeout: 1500 });
          return locator;
        } catch {
          continue;
        }
      }
    }

    await page.waitForTimeout(500);
  }

  const restriction = await detectOldRedditRestriction(page);
  if (restriction) {
    throw new Error(`Could not find the old Reddit comment box on the page. ${restriction}`);
  }

  throw new Error('Could not find the old Reddit comment box on the page.');
}

async function submitOldRedditComment(page) {
  const submitSelectors = [
    'form.usertext button.save',
    '.usertext-edit button.save',
    'button.save:has-text("save")',
    'button[type="submit"]:has-text("save")',
    'input[type="submit"][value="save"]',
  ];

  for (const selector of submitSelectors) {
    const button = page.locator(selector).first();
    if (await button.count()) {
      try {
        await button.waitFor({ state: 'visible', timeout: 3000 });
        console.log(`Old Reddit submit button found with selector: ${selector}`);
        await button.click({ timeout: 5000, noWaitAfter: true });
        await page.waitForTimeout(3000);
        return { clicked: true, selector };
      } catch {
        continue;
      }
    }
  }

  return { clicked: false, selector: null };
}

async function confirmNoOldRedditError(page) {
  await page.waitForTimeout(2500);

  const errorSelectors = [
    '.status.error',
    '.error:has-text("try again")',
    '.error:has-text("doing that too much")',
    '.error:has-text("not allowed")',
    '.error:has-text("log in")',
    '.usertext .error',
  ];

  for (const selector of errorSelectors) {
    const errorLocator = page.locator(selector).first();
    if (await errorLocator.count()) {
      try {
        await errorLocator.waitFor({ state: 'visible', timeout: 1000 });
        const text = ((await errorLocator.textContent().catch(() => null)) || '').trim();
        return {
          ok: false,
          details: text ? `Old Reddit showed an error after submit: ${text}` : `Old Reddit showed an error after submit: ${selector}`,
        };
      } catch {
        continue;
      }
    }
  }

  return { ok: true };
}

async function postWithOldReddit(page, postUrl, commentText) {
  const oldPostUrl = toOldRedditUrl(postUrl);
  console.log(`Trying old Reddit comment form: ${oldPostUrl}`);

  await page.goto(oldPostUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => null);

  const commentInput = await findOldRedditCommentInput(page);
  await typeLikeHuman(commentInput, commentText);
  await page.waitForTimeout(750);

  const submitResult = await submitOldRedditComment(page);
  if (!submitResult.clicked) {
    return buildResult(false, postUrl, commentText, 'No old Reddit submit button found.');
  }

  const confirmation = await confirmNoOldRedditError(page);
  if (!confirmation.ok) {
    return buildResult(false, postUrl, commentText, confirmation.details);
  }

  return buildResult(true, postUrl, commentText);
}

async function expandCommentEditor(page) {
  const placeholderSelectors = [
    'shreddit-composer:has-text("Join the conversation")',
    'shreddit-composer [placeholder*="Join the conversation" i]',
    'shreddit-composer faceplate-textarea',
    '[aria-label*="Join the conversation" i]',
    '[placeholder*="Join the conversation" i]',
    'div[role="textbox"]:has-text("Join the conversation")',
    'button:has-text("Join the conversation")',
    'text="Join the conversation"',
    'text="Add a comment"',
  ];

  for (const selector of placeholderSelectors) {
    const trigger = page.locator(selector).first();
    if (await trigger.count()) {
      try {
        await trigger.scrollIntoViewIfNeeded({ timeout: 5000 });
        await trigger.click({ timeout: 5000 });
        await page.waitForTimeout(1500);
        return;
      } catch {
        continue;
      }
    }
  }

  return;
}

async function clickJoinButtonIfPresent(page) {
  const joinButton = page.getByRole('button', { name: /^Join$/ }).first();
  if (!(await joinButton.count())) {
    return;
  }

  try {
    await joinButton.click({ timeout: 5000 });
    console.log('Clicked Join button before looking for the comment box.');
    await page.waitForTimeout(2000);
  } catch (error) {
    console.log(`Join button was present but could not be clicked: ${error.message}`);
  }
}

async function logRestrictionNotices(page) {
  if (!DEBUG_REDDIT_POSTER) {
    return;
  }

  const selectors = [
    'shreddit-composer',
    'text=/locked/i',
    'text=/restricted/i',
    'text=/archived/i',
    'text=/karma/i',
    'text=/join/i',
    'text=/not available/i',
  ];
  const seen = new Set();

  for (const selector of selectors) {
    const locator = page.locator(selector);
    const count = await locator.count().catch(() => 0);

    for (let index = 0; index < Math.min(count, 5); index += 1) {
      const text = ((await locator.nth(index).textContent().catch(() => null)) || '').trim();
      if (!text || seen.has(text)) {
        continue;
      }

      seen.add(text);
      console.log(`Restriction/debug notice (${selector}): ${text}`);
    }
  }
}

async function detectPostRestriction(page) {
  const restrictionChecks = [
    { label: 'Locked post', selector: '[aria-live="polite"]:has-text("Locked post"), [role="alert"]:has-text("Locked post")' },
    { label: 'Archived post', selector: '[aria-live="polite"]:has-text("Archived post"), [role="alert"]:has-text("Archived post")' },
  ];

  for (const check of restrictionChecks) {
    const locator = page.locator(check.selector).first();
    if (await locator.count().catch(() => 0)) {
      try {
        await locator.waitFor({ state: 'visible', timeout: 1000 });
        return check.label;
      } catch {
        return check.label;
      }
    }
  }

  return null;
}

async function findCommentInput(page) {
  const inputSelectors = [
    'shreddit-composer [contenteditable="true"]',
    'shreddit-composer [role="textbox"]',
    'shreddit-composer [aria-label*="comment" i]',
    'shreddit-composer [aria-placeholder*="Join the conversation" i]',
    'shreddit-composer [data-lexical-editor="true"]',
    '[data-testid="comment-submission-form-richtext"] [contenteditable="true"]',
    '[data-testid="comment-submission-form-richtext"] [role="textbox"]',
    '[slot="rte-body"] [contenteditable="true"]',
    'div[contenteditable="true"][role="textbox"]',
    '[contenteditable="true"]',
    'textarea[name="comment"]',
    'textarea[placeholder*="comment" i]',
    'shreddit-composer textarea',
    'faceplate-textarea textarea',
  ];

  await scrollToCommentSection(page);
  await expandCommentEditor(page);

  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    for (const selector of inputSelectors) {
      const locator = page.locator(selector).first();
      if (await locator.count()) {
        try {
          await locator.waitFor({ state: 'visible', timeout: 1500 });
          return locator;
        } catch {
          if (DEBUG_REDDIT_POSTER) {
            console.log(`Tried selector: ${selector} - not visible yet`);
          }
          continue;
        }
      } else if (DEBUG_REDDIT_POSTER) {
        console.log(`Tried selector: ${selector} - not found`);
      }
    }

    await expandCommentEditor(page);
    await page.waitForTimeout(750);
  }

  const restriction = await detectPostRestriction(page);
  if (restriction) {
    throw new Error(`Could not find the Reddit comment box on the page. ${restriction}`);
  }

  throw new Error('Could not find the Reddit comment box on the page.');
}

async function saveFailureArtifacts(page, postUrl, reason) {
  try {
    await mkdir(DEBUG_ARTIFACTS_DIR, { recursive: true });
    const safeName = `${Date.now()}-${new URL(postUrl).pathname.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '')}`;
    const basePath = path.join(DEBUG_ARTIFACTS_DIR, safeName);
    await page.screenshot({ path: `${basePath}.png`, fullPage: true });
    await writeFile(`${basePath}.html`, await page.content(), 'utf8');
    console.log(`Saved Reddit poster failure artifacts for ${reason}: ${basePath}.png`);
  } catch (error) {
    console.log(`Could not save Reddit poster failure artifacts: ${error.message}`);
  }
}

async function typeLikeHuman(locator, commentText) {
  await locator.click({ timeout: 5000 });

  try {
    await locator.fill(commentText, { timeout: 10000 });
    return;
  } catch {
    // Some Reddit editor variants expose contenteditable nodes that do not support fill().
  }

  try {
    await locator.evaluate((element, value) => {
      element.textContent = value;
      element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    }, commentText);
    return;
  } catch {
    await locator.type(commentText, { delay: 5 });
  }
}

async function submitComment(page) {
  const submitSelectors = [
    'button[type="submit"]',
    'button:has-text("Comment")',
    'button:has-text("Submit")',
  ];

  for (const selector of submitSelectors) {
    const button = page.locator(selector).filter({ hasNotText: 'Cancel' }).first();
    if (await button.count()) {
      try {
        await button.waitFor({ state: 'visible', timeout: 3000 });
        console.log(`Submit button found with selector: ${selector}`);
        await page.waitForTimeout(1000);
        try {
          await button.click({ timeout: 5000, noWaitAfter: true });
        } catch {
          await button.click({ timeout: 5000, noWaitAfter: true, force: true });
        }
        await page.waitForTimeout(3000);
        return { clicked: true, selector };
      } catch {
        continue;
      }
    }
  }

  return { clicked: false, selector: null };
}

async function confirmNoVisibleError(page) {
  await page.waitForTimeout(5000);

  const errorSelectors = [
    'text="Something went wrong"',
    'text="Try again later"',
    'text="Unable to create comment"',
    'text="Please fix the above requirements"',
    '[data-testid="error-message"]',
  ];

  for (const selector of errorSelectors) {
    const errorLocator = page.locator(selector).first();
    if (await errorLocator.count()) {
      try {
        await errorLocator.waitFor({ state: 'visible', timeout: 1000 });
        return {
          ok: false,
          details: `Reddit showed an error after submit: ${selector}`,
        };
      } catch {
        continue;
      }
    }
  }

  const submitButton = page
    .locator('button[type="submit"], button:has-text("Comment"), button:has-text("Submit")')
    .filter({ hasNotText: 'Cancel' })
    .first();
  const commentInput = page
    .locator('shreddit-composer [contenteditable="true"], [slot="rte-body"] [contenteditable="true"], div[contenteditable="true"][role="textbox"]')
    .first();

  const successCheckDeadline = Date.now() + 5000;
  let successSignal = false;

  while (Date.now() < successCheckDeadline) {
    if ((await submitButton.count()) && (await submitButton.isDisabled().catch(() => false))) {
      successSignal = true;
      break;
    }

    if (!(await commentInput.count())) {
      successSignal = true;
      break;
    }

    if (((await commentInput.textContent().catch(() => null)) || '').trim() === '') {
      successSignal = true;
      break;
    }

    await page.waitForTimeout(250);
  }

  if (successSignal) {
    return { ok: true };
  }

  return { ok: true };
}

export async function postComment(postUrl, commentText) {
  if (!postUrl || !commentText) {
    throw new Error('postUrl and commentText are required.');
  }

  const sessionValid = await verifyRedditSession();
  if (!sessionValid) {
    throw new Error('Reddit session is invalid or expired. Re-run the login script first.');
  }

  const cookies = await readSessionCookies();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: REDDIT_USER_AGENT,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);

  try {
    // Keep a hard cap so a stuck Reddit page does not block the queue forever.
    const result = await Promise.race([
      (async () => {
        await context.addCookies(cookies);
        try {
          return await postWithOldReddit(page, postUrl, commentText);
        } catch (oldRedditError) {
          console.log(`Old Reddit posting path failed: ${oldRedditError.message}`);
        }

        await page.goto(postUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await waitForRedditRender(page);

        await clickJoinButtonIfPresent(page);
        await scrollToCommentSection(page);
        await expandCommentEditor(page);
        await logRestrictionNotices(page);

        const commentInput = await findCommentInput(page);
        await typeLikeHuman(commentInput, commentText);
        await page.waitForTimeout(1500);

        const submitResult = await submitComment(page);
        if (!submitResult.clicked) {
          return buildResult(false, postUrl, commentText, 'No submit button found.');
        }

        return buildResult(true, postUrl, commentText);
      })(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Timeout after ${POST_COMMENT_TIMEOUT_MS / 1000}s`)), POST_COMMENT_TIMEOUT_MS)
      ),
    ]);

    if (result.success) {
      console.log(`[${result.timestamp}] success ${result.postUrl} :: ${result.commentPreview}`);
    } else {
      console.error(`[${result.timestamp}] failed ${result.postUrl} :: ${result.commentPreview}`);
    }
    return result;
  } catch (error) {
    await saveFailureArtifacts(page, postUrl, error.message);
    const result = buildResult(false, postUrl, commentText, error.message);
    console.error(`[${result.timestamp}] failed ${result.postUrl} :: ${result.commentPreview}`);
    return result;
  } finally {
    await browser.close();
  }
}

async function main() {
  const postUrl = process.argv[2];
  const commentText = process.argv[3];

  if (!postUrl || !commentText) {
    console.log('Usage:');
    console.log('  node reddit-poster.mjs "https://reddit.com/r/..." "Your comment here"');
    process.exitCode = 1;
    return;
  }

  try {
    const result = await postComment(postUrl, commentText);
    console.log(result);
    if (!result.success) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

const currentFilePath = fileURLToPath(import.meta.url);
const entryFilePath = process.argv[1] ? path.resolve(process.argv[1]) : '';

if (currentFilePath === entryFilePath) {
  main().catch((error) => {
    console.error(`Unexpected error while posting to Reddit. ${error.message}`);
    process.exit(1);
  });
}
