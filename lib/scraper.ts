// ============================================
// Main Scraper Module
// Elite resilient scraping engine for Amazon.in
// ============================================

import { chromium as playwrightChromium } from 'playwright-core';
import chromium from '@sparticuz/chromium';
import {
  RankCheckRequest,
  RankCheckResponse,
  RankResult,
  ScraperConfig,
  DEFAULT_SCRAPER_CONFIG,
  BROWSER_CONFIG,
  ASIN_PATTERN,
  KEYWORD_CONSTRAINTS,
  ErrorCode,
} from './types';
import { parseSearchResults, hasCaptcha, hasNoResults, ParseResult } from './amazonParser';
import { setDeliveryLocation, getLocationAwareSearchUrl } from './locationHandler';
import {
  executeWithRetry,
  createErrorResponse,
  classifyError,
  getErrorMessage,
  sleep,
  RetryConfig,
  DEFAULT_RETRY_CONFIG,
} from './retryHandler';
import type { Browser, BrowserContext, Page } from 'playwright-core';

/**
 * Main entry point for rank checking
 * Handles validation, browser management, and retry logic
 */
export async function checkAsinRank(
  request: RankCheckRequest,
  config: ScraperConfig = DEFAULT_SCRAPER_CONFIG
): Promise<RankCheckResponse> {
  // Input validation
  const validationError = validateInput(request);
  if (validationError) {
    return createErrorResponse(validationError);
  }

  // Normalize inputs
  const normalizedAsin = request.asin.toUpperCase().trim();
  const normalizedKeyword = request.keyword.trim();

  // Execute with retry logic
  const retryConfig: RetryConfig = {
    ...DEFAULT_RETRY_CONFIG,
    maxRetries: config.maxRetries,
    baseBackoffMs: config.baseBackoffMs,
  };

  let browser: Browser | null = null;
  let lastError: ErrorCode = 'unknown_error';

  for (let attempt = 0; attempt <= retryConfig.maxRetries; attempt++) {
    try {
      // Launch browser for each attempt (clean context)
      browser = await launchBrowser();

      const result = await executeSearch(
        browser,
        normalizedAsin,
        normalizedKeyword,
        request,
        config
      );

      await browser.close();
      return result;
    } catch (error) {
      lastError = classifyError(error);
      console.error(`Attempt ${attempt + 1} failed:`, error);

      // Clean up browser
      if (browser) {
        try {
          await browser.close();
        } catch {
          // Ignore close errors
        }
        browser = null;
      }

      // Check if we should retry
      if (!retryConfig.retryableErrors.includes(lastError)) {
        break;
      }

      // Wait before retry (if not last attempt)
      if (attempt < retryConfig.maxRetries) {
        const backoff = retryConfig.baseBackoffMs * Math.pow(2, attempt);
        await sleep(backoff);
      }
    }
  }

  return createErrorResponse(lastError);
}

/**
 * Validates input parameters
 */
function validateInput(request: RankCheckRequest): ErrorCode | null {
  // Validate ASIN
  if (!request.asin || !ASIN_PATTERN.test(request.asin.toUpperCase())) {
    return 'invalid_input';
  }

  // Validate keyword
  if (
    !request.keyword ||
    request.keyword.length < KEYWORD_CONSTRAINTS.minLength ||
    request.keyword.length > KEYWORD_CONSTRAINTS.maxLength
  ) {
    return 'invalid_input';
  }

  // Sanitize keyword - check for injection attempts
  const dangerousPatterns = [
    /<script/i,
    /javascript:/i,
    /on\w+=/i,
    /data:/i,
  ];

  for (const pattern of dangerousPatterns) {
    if (pattern.test(request.keyword)) {
      return 'invalid_input';
    }
  }

  return null;
}

/**
 * Launches browser with Vercel-compatible configuration
 */
async function launchBrowser(): Promise<Browser> {
  const isVercel = process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME;

  const browser = await playwrightChromium.launch({
    args: isVercel
      ? chromium.args
      : [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--single-process',
        ],
    executablePath: isVercel
      ? await chromium.executablePath()
      : undefined,
    headless: true,
  });

  return browser;
}

/**
 * Creates browser context with anti-detection measures
 */
async function createContext(browser: Browser): Promise<BrowserContext> {
  const context = await browser.newContext({
    userAgent: BROWSER_CONFIG.userAgent,
    viewport: BROWSER_CONFIG.viewport,
    locale: BROWSER_CONFIG.locale,
    timezoneId: BROWSER_CONFIG.timezone,
    deviceScaleFactor: 1,
    hasTouch: false,
    isMobile: false,
    javaScriptEnabled: true,
  });

  // Set request interception to block unnecessary resources
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await context.route('**/*', (route: any) => {
    const resourceType = route.request().resourceType();
    const url = route.request().url();

    // Block images, fonts, and media
    if (['image', 'font', 'media', 'stylesheet'].includes(resourceType)) {
      return route.abort();
    }

    // Block tracking/analytics scripts
    const blockPatterns = [
      'google-analytics',
      'googletagmanager',
      'facebook',
      'doubleclick',
      'amazon-adsystem',
      'criteo',
    ];

    if (blockPatterns.some((p) => url.includes(p))) {
      return route.abort();
    }

    return route.continue();
  });

  return context;
}

/**
 * Executes search across multiple pages
 */
async function executeSearch(
  browser: Browser,
  asin: string,
  keyword: string,
  request: RankCheckRequest,
  config: ScraperConfig
): Promise<RankCheckResponse> {
  const context = await createContext(browser);
  const page = await context.newPage();

  // Set location if enabled
  if (request.enableLocation && request.locationPincode) {
    await setDeliveryLocation(page, request.locationPincode);
  }

  // Track cumulative ranks across pages
  let cumulativeOrganicRank = 0;
  let cumulativeSponsoredRank = 0;
  let totalScanned = 0;

  try {
    for (let pageNum = 1; pageNum <= config.maxPages; pageNum++) {
      // Navigate to search page
      const searchUrl = getLocationAwareSearchUrl(keyword, pageNum, request.locationPincode);
      
      await page.goto(searchUrl, {
        waitUntil: 'domcontentloaded',
        timeout: config.navigationTimeoutMs,
      });

      // Check for CAPTCHA
      if (await hasCaptcha(page)) {
        throw new Error('CAPTCHA detected');
      }

      // Check for no results
      if (await hasNoResults(page)) {
        if (pageNum === 1) {
          return createErrorResponse('asin_not_found');
        }
        break;
      }

      // Wait for results to load
      await waitForResults(page, config.requestTimeoutMs);

      // Add micro delay for anti-detection
      await sleep(500 + Math.random() * 500);

      // Parse results
      const parseResult = await parseSearchResults(page, asin);
      totalScanned += parseResult.totalResults;

      // Check if ASIN found
      if (parseResult.found) {
        // Calculate final ranks including previous pages
        const result: RankResult = {
          asin,
          keyword,
          organicRank: parseResult.organicRank !== null
            ? cumulativeOrganicRank + parseResult.organicRank
            : null,
          sponsoredRank: parseResult.sponsoredRank !== null
            ? cumulativeSponsoredRank + parseResult.sponsoredRank
            : null,
          pageFound: pageNum,
          positionOnPage: parseResult.position,
          totalResultsScanned: totalScanned,
          scannedPages: pageNum,
          timestamp: new Date().toISOString(),
        };

        return {
          success: true,
          data: result,
        };
      }

      // Update cumulative counts for next page
      cumulativeOrganicRank += countOrganic(parseResult);
      cumulativeSponsoredRank += countSponsored(parseResult);

      // Delay between pages
      if (pageNum < config.maxPages) {
        await sleep(config.scrollDelayMs + Math.random() * 500);
      }
    }

    // ASIN not found after scanning all pages
    return {
      success: true,
      data: {
        asin,
        keyword,
        organicRank: null,
        sponsoredRank: null,
        pageFound: null,
        positionOnPage: null,
        totalResultsScanned: totalScanned,
        scannedPages: config.maxPages,
        timestamp: new Date().toISOString(),
      },
    };
  } finally {
    await page.close();
    await context.close();
  }
}

/**
 * Waits for search results to load
 */
async function waitForResults(page: Page, timeout: number): Promise<void> {
  try {
    // Wait for primary selector
    await page.waitForSelector(
      'div[data-component-type="s-search-result"], [data-asin]',
      { timeout }
    );
  } catch {
    // If selector not found, check if page loaded but has no results
    const bodyLength = await page.evaluate(() => document.body.innerHTML.length);
    if (bodyLength < 1000) {
      throw new Error('Page failed to load properly');
    }
  }
}

/**
 * Counts organic results from parse result
 */
function countOrganic(result: ParseResult): number {
  return result.totalOrganicCount;
}

/**
 * Counts sponsored results from parse result
 */
function countSponsored(result: ParseResult): number {
  return result.totalSponsoredCount;
}

/**
 * Sanitizes string for safe use
 */
export function sanitizeString(str: string): string {
  return str
    .replace(/[<>]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .trim();
}
