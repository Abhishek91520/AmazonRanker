// ============================================
// Main Scraper Module
// Elite resilient scraping engine for Amazon.in
// Using Puppeteer for Vercel compatibility
// ============================================

import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import type { Browser, Page, HTTPRequest } from 'puppeteer-core';
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
  createErrorResponse,
  classifyError,
  sleep,
  RetryConfig,
  DEFAULT_RETRY_CONFIG,
} from './retryHandler';

function scraperLog(runId: string, message: string, meta?: Record<string, unknown>): void {
  const timestamp = new Date().toISOString();
  if (meta) {
    console.log(`[SCRAPER][${timestamp}][${runId}] ${message}`, meta);
    return;
  }
  console.log(`[SCRAPER][${timestamp}][${runId}] ${message}`);
}

type DebugLogger = (step: string, meta?: Record<string, unknown>) => void;

/**
 * Main entry point for rank checking
 * Handles validation, browser management, and retry logic
 */
export async function checkAsinRank(
  request: RankCheckRequest,
  config: ScraperConfig = DEFAULT_SCRAPER_CONFIG,
  debugLogger?: DebugLogger
): Promise<RankCheckResponse> {
  const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = Date.now();

  scraperLog(runId, 'Rank check request received', {
    asin: request.asin,
    keyword: request.keyword,
    maxPages: config.maxPages,
    maxRetries: config.maxRetries,
    enableLocation: request.enableLocation,
    locationPincode: request.locationPincode || null,
  });
  debugLogger?.('request_received', {
    asin: request.asin,
    keyword: request.keyword,
    maxPages: config.maxPages,
    maxRetries: config.maxRetries,
    enableLocation: request.enableLocation,
    locationPincode: request.locationPincode || null,
  });

  // Input validation
  const validationError = validateInput(request);
  if (validationError) {
    scraperLog(runId, 'Input validation failed', { validationError });
    debugLogger?.('validation_failed', { validationError });
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
      scraperLog(runId, 'Starting attempt', {
        attempt: attempt + 1,
        totalAttempts: retryConfig.maxRetries + 1,
      });
      debugLogger?.('attempt_started', {
        attempt: attempt + 1,
        totalAttempts: retryConfig.maxRetries + 1,
      });

      // Launch browser for each attempt (clean context)
      browser = await launchBrowser();
      scraperLog(runId, 'Browser launched successfully');
      debugLogger?.('browser_launched', {
        attempt: attempt + 1,
      });

      const result = await executeSearch(
        browser,
        normalizedAsin,
        normalizedKeyword,
        request,
        config,
        runId,
        debugLogger
      );

      await browser.close();
      scraperLog(runId, 'Attempt succeeded', {
        durationMs: Date.now() - startedAt,
      });
      debugLogger?.('attempt_succeeded', {
        attempt: attempt + 1,
        durationMs: Date.now() - startedAt,
      });
      return result;
    } catch (error) {
      lastError = classifyError(error);
      scraperLog(runId, 'Attempt failed', {
        attempt: attempt + 1,
        errorCode: lastError,
        error: error instanceof Error ? error.message : String(error),
      });
      debugLogger?.('attempt_failed', {
        attempt: attempt + 1,
        errorCode: lastError,
        error: error instanceof Error ? error.message : String(error),
      });

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
        scraperLog(runId, 'Error is non-retryable, stopping retries', { errorCode: lastError });
        debugLogger?.('non_retryable_error', { errorCode: lastError });
        break;
      }

      // Wait before retry (if not last attempt)
      if (attempt < retryConfig.maxRetries) {
        const backoff = retryConfig.baseBackoffMs * Math.pow(2, attempt);
        scraperLog(runId, 'Waiting before retry', { backoffMs: backoff });
        debugLogger?.('retry_waiting', { backoffMs: backoff });
        await sleep(backoff);
      }
    }
  }

  scraperLog(runId, 'All attempts exhausted', {
    lastError,
    durationMs: Date.now() - startedAt,
  });
  debugLogger?.('all_attempts_exhausted', {
    lastError,
    durationMs: Date.now() - startedAt,
  });
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

  if (isVercel) {
    // On Vercel: Use @sparticuz/chromium
    const executablePath = await chromium.executablePath();
    
    const browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: executablePath,
      headless: chromium.headless,
    });
    
    return browser;
  } else {
    // Local development: Try to find Chrome/Chromium
    const browser = await puppeteer.launch({
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
      headless: true,
      // Try common Chrome paths for local development
      executablePath: process.platform === 'win32'
        ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
        : process.platform === 'darwin'
        ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
        : '/usr/bin/google-chrome',
    });
    
    return browser;
  }
}

/**
 * Executes search across multiple pages
 */
async function executeSearch(
  browser: Browser,
  asin: string,
  keyword: string,
  request: RankCheckRequest,
  config: ScraperConfig,
  runId: string,
  debugLogger?: DebugLogger
): Promise<RankCheckResponse> {
  const page = await browser.newPage();
  scraperLog(runId, 'New page created');
  debugLogger?.('page_created');
  
  // Set user agent and viewport
  await page.setUserAgent(BROWSER_CONFIG.userAgent);
  await page.setViewport(BROWSER_CONFIG.viewport);

  // Set extra HTTP headers to look more like a real browser
  await page.setExtraHTTPHeaders({
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-IN,en-GB;q=0.9,en;q=0.8',
    'Cache-Control': 'max-age=0',
    'Sec-CH-UA': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
    'Sec-CH-UA-Mobile': '?0',
    'Sec-CH-UA-Platform': '"Windows"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
  });

  // Override navigator properties to avoid detection
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'plugins', { 
      get: () => {
        const plugins = [{ name: 'Chrome PDF Plugin' }, { name: 'Chrome PDF Viewer' }, { name: 'Native Client' }];
        // @ts-ignore
        plugins.length = 3;
        return plugins;
      }
    });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-IN', 'en-GB', 'en'] });
    Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
    Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
    // @ts-ignore
    window.chrome = { runtime: {}, loadTimes: () => {}, csi: () => {} };
    // Hide automation
    delete Object.getPrototypeOf(navigator).webdriver;
  });

  // Block unnecessary resources to speed up loading
  await page.setRequestInterception(true);
  page.on('request', (req: HTTPRequest) => {
    const resourceType = req.resourceType();
    const url = req.url();
    
    // Block images, fonts, media, and tracking
    if (['image', 'font', 'media', 'stylesheet'].includes(resourceType)) {
      req.abort();
      return;
    }
    
    const blockPatterns = [
      'google-analytics',
      'googletagmanager',
      'facebook',
      'doubleclick',
      'amazon-adsystem',
    ];
    
    if (blockPatterns.some((p) => url.includes(p))) {
      req.abort();
      return;
    }
    
    req.continue();
  });

  // Set location if enabled
  if (request.enableLocation && request.locationPincode) {
    await setDeliveryLocation(page, request.locationPincode);
    scraperLog(runId, 'Location set', { locationPincode: request.locationPincode });
    debugLogger?.('location_set', { locationPincode: request.locationPincode });
  }

  // Set cookies to look like a returning visitor
  await page.setCookie(
    {
      name: 'session-id',
      value: `${Date.now()}-${Math.random().toString(36).substring(7)}`,
      domain: '.amazon.in',
      path: '/',
    },
    {
      name: 'i18n-prefs',
      value: 'INR',
      domain: '.amazon.in',
      path: '/',
    },
    {
      name: 'lc-acbin',
      value: 'en_IN',
      domain: '.amazon.in',
      path: '/',
    }
  );

  // Track cumulative ranks across pages
  let cumulativeOrganicRank = 0;
  let cumulativeSponsoredRank = 0;
  let totalScanned = 0;

  try {
    for (let pageNum = 1; pageNum <= config.maxPages; pageNum++) {
      // Navigate to search page
      const searchUrl = getLocationAwareSearchUrl(keyword, pageNum, request.locationPincode);
      scraperLog(runId, 'Navigating to search page', { pageNum, searchUrl });
      debugLogger?.('navigation_started', { pageNum, searchUrl });
      
      await page.goto(searchUrl, {
        waitUntil: 'domcontentloaded',
        timeout: config.navigationTimeoutMs,
        referer: pageNum === 1 ? 'https://www.google.com/' : 'https://www.amazon.in/',
      });
      scraperLog(runId, 'Navigation complete', { pageNum });
      debugLogger?.('navigation_completed', { pageNum });

      // Check for CAPTCHA
      if (await hasCaptcha(page)) {
        scraperLog(runId, 'CAPTCHA detected', { pageNum });
        debugLogger?.('captcha_detected', { pageNum });
        throw new Error('CAPTCHA detected');
      }

      // Check for no results
      if (await hasNoResults(page)) {
        scraperLog(runId, 'No results detected on page', { pageNum });
        debugLogger?.('no_results_detected', { pageNum });
        if (pageNum === 1) {
          return createErrorResponse('asin_not_found');
        }
        break;
      }

      // Wait for results to load
      await waitForResults(page, config.requestTimeoutMs);

      // Minimal delay for anti-detection
      await sleep(200);

      // Parse results
      const parseResult = await parseSearchResults(page, asin);
      totalScanned += parseResult.totalResults;
      scraperLog(runId, 'Page parsed', {
        pageNum,
        found: parseResult.found,
        organicRankOnPage: parseResult.organicRank,
        sponsoredRankOnPage: parseResult.sponsoredRank,
        totalResultsOnPage: parseResult.totalResults,
        totalOrganicCount: parseResult.totalOrganicCount,
        totalSponsoredCount: parseResult.totalSponsoredCount,
      });
      debugLogger?.('page_parsed', {
        pageNum,
        found: parseResult.found,
        organicRankOnPage: parseResult.organicRank,
        sponsoredRankOnPage: parseResult.sponsoredRank,
        totalResultsOnPage: parseResult.totalResults,
        totalOrganicCount: parseResult.totalOrganicCount,
        totalSponsoredCount: parseResult.totalSponsoredCount,
      });

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
      cumulativeOrganicRank += parseResult.totalOrganicCount;
      cumulativeSponsoredRank += parseResult.totalSponsoredCount;

      // Brief delay between pages
      if (pageNum < config.maxPages) {
        await sleep(300);
      }
    }

    // Fallback strategy: If location was enabled and ASIN not found,
    // retry scan without location constraints because sponsored inventory can vary by pincode.
    if (request.enableLocation && request.locationPincode) {
      scraperLog(runId, 'Starting no-location fallback scan', {
        previousLocationPincode: request.locationPincode,
        pagesToScan: config.maxPages,
      });
      debugLogger?.('no_location_fallback_started', {
        previousLocationPincode: request.locationPincode,
        pagesToScan: config.maxPages,
      });

      try {
        // Clear location cookies/storage that can force location-specific inventory.
        await page.deleteCookie(
          { name: 'ubid-acbin', domain: '.amazon.in', path: '/' },
          { name: 'session-id', domain: '.amazon.in', path: '/' },
          { name: 'lc-acbin', domain: '.amazon.in', path: '/' },
          { name: 'i18n-prefs', domain: '.amazon.in', path: '/' }
        );
        await page.evaluate(() => {
          try {
            localStorage.removeItem('glow-pincode');
            localStorage.removeItem('glow-validatedPincode');
            localStorage.removeItem('glow-locationDisplaySetting');
            sessionStorage.removeItem('s-zipcode');
          } catch {
            // Ignore storage cleanup errors
          }
        });
      } catch (cleanupError) {
        scraperLog(runId, 'No-location fallback cleanup warning', {
          error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
        });
      }

      let fallbackCumulativeOrganic = 0;
      let fallbackCumulativeSponsored = 0;
      let fallbackTotalScanned = 0;

      for (let fallbackPageNum = 1; fallbackPageNum <= config.maxPages; fallbackPageNum++) {
        const fallbackUrl = getLocationAwareSearchUrl(keyword, fallbackPageNum, undefined);
        scraperLog(runId, 'Navigating fallback no-location page', {
          pageNum: fallbackPageNum,
          fallbackUrl,
        });
        debugLogger?.('no_location_fallback_navigation_started', {
          pageNum: fallbackPageNum,
          fallbackUrl,
        });

        await page.goto(fallbackUrl, {
          waitUntil: 'domcontentloaded',
          timeout: config.navigationTimeoutMs,
          referer: 'https://www.amazon.in/',
        });

        await waitForResults(page, config.requestTimeoutMs);
        await sleep(200);

        const fallbackParse = await parseSearchResults(page, asin);
        fallbackTotalScanned += fallbackParse.totalResults;

        scraperLog(runId, 'No-location fallback page parsed', {
          pageNum: fallbackPageNum,
          found: fallbackParse.found,
          organicRankOnPage: fallbackParse.organicRank,
          sponsoredRankOnPage: fallbackParse.sponsoredRank,
          totalResultsOnPage: fallbackParse.totalResults,
        });
        debugLogger?.('no_location_fallback_page_parsed', {
          pageNum: fallbackPageNum,
          found: fallbackParse.found,
          organicRankOnPage: fallbackParse.organicRank,
          sponsoredRankOnPage: fallbackParse.sponsoredRank,
          totalResultsOnPage: fallbackParse.totalResults,
        });

        if (fallbackParse.found) {
          const fallbackResult: RankResult = {
            asin,
            keyword,
            organicRank:
              fallbackParse.organicRank !== null
                ? fallbackCumulativeOrganic + fallbackParse.organicRank
                : null,
            sponsoredRank:
              fallbackParse.sponsoredRank !== null
                ? fallbackCumulativeSponsored + fallbackParse.sponsoredRank
                : null,
            pageFound: fallbackPageNum,
            positionOnPage: fallbackParse.position,
            totalResultsScanned: fallbackTotalScanned,
            scannedPages: fallbackPageNum,
            timestamp: new Date().toISOString(),
          };

          scraperLog(runId, 'No-location fallback succeeded', {
            organicRank: fallbackResult.organicRank,
            sponsoredRank: fallbackResult.sponsoredRank,
            pageFound: fallbackResult.pageFound,
          });
          debugLogger?.('no_location_fallback_succeeded', {
            organicRank: fallbackResult.organicRank,
            sponsoredRank: fallbackResult.sponsoredRank,
            pageFound: fallbackResult.pageFound,
          });

          return {
            success: true,
            data: fallbackResult,
          };
        }

        fallbackCumulativeOrganic += fallbackParse.totalOrganicCount;
        fallbackCumulativeSponsored += fallbackParse.totalSponsoredCount;

        if (fallbackPageNum < config.maxPages) {
          await sleep(300);
        }
      }

      scraperLog(runId, 'No-location fallback finished without match', {
        totalScanned: fallbackTotalScanned,
      });
      debugLogger?.('no_location_fallback_failed', {
        totalScanned: fallbackTotalScanned,
      });
    }

    // ASIN not found after all strategies
    scraperLog(runId, 'ASIN not found after scanning all pages', {
      asin,
      keyword,
      totalScanned,
      scannedPages: config.maxPages,
    });
    debugLogger?.('asin_not_found_after_scan', {
      asin,
      keyword,
      totalScanned,
      scannedPages: config.maxPages,
    });
    return createErrorResponse('asin_not_found');
  } finally {
    scraperLog(runId, 'Closing page');
    debugLogger?.('page_closing');
    await page.close();
  }
}

/**
 * Waits for search results to load
 */
async function waitForResults(page: Page, timeout: number): Promise<void> {
  try {
    await page.waitForSelector(
      'div[data-component-type="s-search-result"], [data-asin]',
      { timeout }
    );
  } catch {
    // If selector not found, check if page loaded
    const bodyLength = await page.evaluate(() => document.body.innerHTML.length);
    if (bodyLength < 1000) {
      throw new Error('Page failed to load properly');
    }
  }
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
