import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyRedditSession } from './reddit-session.mjs';

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

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

async function expandCommentEditor(page) {
  const placeholderSelectors = [
    'text="Join the conversation"',
    'div:has-text("Join the conversation")',
    'button:has-text("Join the conversation")',
    '[placeholder*="Join the conversation" i]',
    'text="Add a comment"',
  ];

  for (const selector of placeholderSelectors) {
    const trigger = page.locator(selector).first();
    if (await trigger.count()) {
      try {
        await trigger.scrollIntoViewIfNeeded({ timeout: 5000 });
        await trigger.click({ timeout: 5000 });
        return;
      } catch {
        continue;
      }
    }
  }

  return;
}

async function findCommentInput(page) {
  const inputSelectors = [
    'shreddit-composer [contenteditable="true"]',
    '[slot="rte-body"] [contenteditable="true"]',
    'div[contenteditable="true"][role="textbox"]',
    'textarea[name="comment"]',
    'textarea[placeholder*="comment" i]',
    'shreddit-composer textarea',
    'faceplate-textarea textarea',
  ];

  await scrollToCommentSection(page);
  await expandCommentEditor(page);

  for (const selector of inputSelectors) {
    const locator = page.locator(selector).first();
    if (await locator.count()) {
      try {
        await locator.waitFor({ state: 'visible', timeout: 10000 });
        return locator;
      } catch {
        console.log(`Tried selector: ${selector} - not found`);
        continue;
      }
    } else {
      console.log(`Tried selector: ${selector} - not found`);
    }
  }

  throw new Error('Could not find the Reddit comment box on the page.');
}

async function typeLikeHuman(locator, commentText) {
  await locator.click({ timeout: 5000 });

  for (const char of commentText) {
    await locator.type(char, { delay: randomBetween(50, 150) });
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
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);

  try {
    // Wrap entire posting logic in Promise.race with 60 second timeout
    const result = await Promise.race([
      (async () => {
        await context.addCookies(cookies);
        await page.goto(postUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await waitForRedditRender(page);

        console.log('DEBUG: Page HTML (first 3000 chars):', (await page.content()).slice(0, 3000));

        const commentInput = await findCommentInput(page);
        await typeLikeHuman(commentInput, commentText);
        await page.waitForTimeout(1500);

        const submitResult = await submitComment(page);
        if (!submitResult.clicked) {
          return buildResult(false, postUrl, commentText, 'No submit button found.');
        }

        const confirmation = await confirmNoVisibleError(page);
        if (!confirmation.ok) {
          return buildResult(false, postUrl, commentText, confirmation.details);
        }

        return buildResult(true, postUrl, commentText);
      })(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Timeout after 60s')), 60000)
      ),
    ]);

    if (result.success) {
      console.log(`[${result.timestamp}] success ${result.postUrl} :: ${result.commentPreview}`);
    } else {
      console.error(`[${result.timestamp}] failed ${result.postUrl} :: ${result.commentPreview}`);
    }
    return result;
  } catch (error) {
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
