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
  config: ScraperConfig
): Promise<RankCheckResponse> {
  const page = await browser.newPage();
  
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
      
      await page.goto(searchUrl, {
        waitUntil: 'domcontentloaded',
        timeout: config.navigationTimeoutMs,
        referer: pageNum === 1 ? 'https://www.google.com/' : 'https://www.amazon.in/',
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

      // Minimal delay for anti-detection
      await sleep(200);

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
      cumulativeOrganicRank += parseResult.totalOrganicCount;
      cumulativeSponsoredRank += parseResult.totalSponsoredCount;

      // Brief delay between pages
      if (pageNum < config.maxPages) {
        await sleep(300);
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
