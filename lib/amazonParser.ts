// ============================================
// Amazon Parser Module
// Layout-resilient DOM parsing engine
// ============================================

import type { Page, ElementHandle } from 'playwright-core';
import { SearchResultItem, AMAZON_SELECTORS } from './types';
import { classifySponsored, isSponsored } from './sponsoredClassifier';
import { 
  isInBoundaryZone, 
  validateBoundaryResult, 
  quickValidateBoundaryResult 
} from './boundaryValidator';

/**
 * Parses search results from Amazon page
 * Uses multi-phase parsing for comprehensive result capture
 */
export async function parseSearchResults(
  page: Page,
  targetAsin: string
): Promise<ParseResult> {
  // Phase 1: Initial parse
  let results = await extractResults(page);

  // Phase 2: Scroll and re-parse for lazy-loaded content
  await scrollAndWait(page);
  const additionalResults = await extractResults(page);

  // Merge results, removing duplicates
  results = mergeResults(results, additionalResults);

  // Find target ASIN and calculate ranks
  return calculateRanks(results, targetAsin);
}

/**
 * Extracts search result items from page
 */
async function extractResults(page: Page): Promise<ExtractedResult[]> {
  const results: ExtractedResult[] = [];

  // Try primary selector first
  let elements = await page.$$(AMAZON_SELECTORS.primaryResult);

  // Fallback to data-asin selector if primary fails
  if (elements.length === 0) {
    elements = await page.$$(AMAZON_SELECTORS.fallbackResult);
  }

  for (let i = 0; i < elements.length; i++) {
    const element = elements[i];
    const extracted = await extractSingleResult(element, i + 1);
    
    if (extracted && extracted.asin && extracted.asin.length === 10) {
      results.push(extracted);
    }
  }

  return results;
}

/**
 * Extracts data from a single search result element
 */
async function extractSingleResult(
  element: ElementHandle,
  position: number
): Promise<ExtractedResult | null> {
  try {
    // Get ASIN from data attribute
    const asin = await element.getAttribute('data-asin');
    
    if (!asin || asin.length !== 10) {
      return null;
    }

    // Get outer HTML for sponsored classification
    const outerHtml = await element.evaluate((el: Element) => el.outerHTML);

    // Classify sponsored status
    const sponsoredSignals = classifySponsored(outerHtml);
    const sponsored = isSponsored(sponsoredSignals);

    return {
      asin,
      position,
      isSponsored: sponsored,
      html: outerHtml,
      sponsoredSignals,
    };
  } catch (error) {
    return null;
  }
}

/**
 * Scrolls page halfway and waits for lazy content
 */
async function scrollAndWait(page: Page): Promise<void> {
  try {
    // Get viewport height
    const viewportHeight = await page.evaluate(() => window.innerHeight);
    const documentHeight = await page.evaluate(() => document.body.scrollHeight);

    // Scroll to middle of page
    const scrollTarget = Math.min(documentHeight / 2, viewportHeight * 2);
    await page.evaluate((y: number) => window.scrollTo({ top: y, behavior: 'smooth' }), scrollTarget);

    // Wait for lazy-loaded content
    await page.waitForTimeout(1500 + Math.random() * 500);

    // Additional small scrolls to trigger more lazy loading
    await page.evaluate((y: number) => window.scrollTo({ top: y + 200, behavior: 'smooth' }), scrollTarget);
    await page.waitForTimeout(500);
  } catch (error) {
    // Non-critical, continue with what we have
  }
}

/**
 * Merges two result arrays, removing duplicates by ASIN
 */
function mergeResults(
  primary: ExtractedResult[],
  secondary: ExtractedResult[]
): ExtractedResult[] {
  const asinSet = new Set(primary.map(r => r.asin));
  const merged = [...primary];

  for (const result of secondary) {
    if (!asinSet.has(result.asin)) {
      merged.push(result);
      asinSet.add(result.asin);
    }
  }

  return merged;
}

/**
 * Calculates organic and sponsored ranks for target ASIN
 */
function calculateRanks(
  results: ExtractedResult[],
  targetAsin: string
): ParseResult {
  let organicRank = 0;
  let sponsoredRank = 0;
  let foundResult: ExtractedResult | null = null;
  let foundPosition = 0;

  for (const result of results) {
    // Increment appropriate counter
    if (result.isSponsored) {
      sponsoredRank++;
    } else {
      organicRank++;
    }

    // Check if this is our target
    if (result.asin.toUpperCase() === targetAsin.toUpperCase()) {
      foundResult = result;
      foundPosition = result.position;
      break;
    }
  }

  // If not found, reset ranks
  if (!foundResult) {
    return {
      found: false,
      organicRank: null,
      sponsoredRank: null,
      position: null,
      totalResults: results.length,
      boundaryValidated: false,
    };
  }

  // Perform boundary validation if in boundary zone
  let boundaryValidated = true;
  if (isInBoundaryZone(foundPosition, results.length)) {
    boundaryValidated = quickValidateBoundaryResult(targetAsin, foundResult.html);
    
    // If quick validation fails, do full validation
    if (!boundaryValidated) {
      const fullValidation = validateBoundaryResult(
        targetAsin,
        foundResult.html,
        foundPosition,
        results.length
      );
      boundaryValidated = fullValidation.isValid;
    }
  }

  // Return appropriate rank based on sponsored status
  return {
    found: true,
    organicRank: foundResult.isSponsored ? null : organicRank,
    sponsoredRank: foundResult.isSponsored ? sponsoredRank : null,
    position: foundPosition,
    totalResults: results.length,
    boundaryValidated,
    isSponsored: foundResult.isSponsored,
  };
}

/**
 * Checks if page has CAPTCHA
 */
export async function hasCaptcha(page: Page): Promise<boolean> {
  try {
    const captchaElement = await page.$(AMAZON_SELECTORS.captcha);
    const captchaForm = await page.$(AMAZON_SELECTORS.captchaForm);
    return captchaElement !== null || captchaForm !== null;
  } catch {
    return false;
  }
}

/**
 * Checks if page has no results
 */
export async function hasNoResults(page: Page): Promise<boolean> {
  try {
    // Check for "No results" message
    const noResultsPattern = /no results|0 results|didn't match|no se encontraron/i;
    const bodyText = await page.evaluate(() => document.body.innerText);
    return noResultsPattern.test(bodyText.substring(0, 1000));
  } catch {
    return false;
  }
}

/**
 * Gets total number of result pages (approximation)
 */
export async function getTotalPages(page: Page): Promise<number> {
  try {
    // Look for pagination
    const pagination = await page.$('.s-pagination-strip');
    if (!pagination) {
      return 1;
    }

    // Find last page number
    const lastPageText = await page.evaluate(() => {
      const pages = document.querySelectorAll('.s-pagination-item:not(.s-pagination-next)');
      if (pages.length > 0) {
        const last = pages[pages.length - 1];
        return last.textContent || '1';
      }
      return '1';
    });

    const pageNum = parseInt(lastPageText, 10);
    return isNaN(pageNum) ? 1 : Math.min(pageNum, 10);
  } catch {
    return 1;
  }
}

// Internal types
interface ExtractedResult {
  asin: string;
  position: number;
  isSponsored: boolean;
  html: string;
  sponsoredSignals: ReturnType<typeof classifySponsored>;
}

export interface ParseResult {
  found: boolean;
  organicRank: number | null;
  sponsoredRank: number | null;
  position: number | null;
  totalResults: number;
  boundaryValidated: boolean;
  isSponsored?: boolean;
}
