// ============================================
// Amazon Parser Module
// Layout-resilient DOM parsing engine
// ============================================

import type { Page, ElementHandle } from 'puppeteer-core';
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
  // Debug: Log page URL and title
  const pageUrl = page.url();
  const pageTitle = await page.title();
  console.log(`[Parser] URL: ${pageUrl}`);
  console.log(`[Parser] Title: ${pageTitle}`);

  // Phase 1: Initial parse
  let results = await extractResults(page);
  console.log(`[Parser] Phase 1 results: ${results.length}`);

  // Phase 2: Scroll and re-parse for lazy-loaded content
  await scrollAndWait(page);
  const additionalResults = await extractResults(page);
  console.log(`[Parser] Phase 2 additional: ${additionalResults.length}`);

  // Merge results, removing duplicates
  results = mergeResults(results, additionalResults);
  console.log(`[Parser] Total merged: ${results.length}`);

  // Debug: Log first few ASINs found
  if (results.length > 0) {
    const sampleAsins = results.slice(0, 5).map(r => r.asin);
    console.log(`[Parser] Sample ASINs: ${sampleAsins.join(', ')}`);
  } else {
    // Debug: Check what's on the page
    const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 500));
    console.log(`[Parser] No results. Body preview: ${bodyText.replace(/\n/g, ' ').substring(0, 200)}`);
  }

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
    // Get ASIN from data attribute (puppeteer-compatible)
    const asin = await element.evaluate((el: Element) => el.getAttribute('data-asin'));
    
    if (!asin || asin.length !== 10) {
      return null;
    }

    // Get outer HTML for sponsored classification
    const outerHtml = await element.evaluate((el: Element) => el.outerHTML);

    // Classify sponsored status using multi-signal detection
    const sponsoredSignals = classifySponsored(outerHtml);
    let sponsored = isSponsored(sponsoredSignals);

    // Fallback: Direct DOM check for sponsored indicators
    if (!sponsored) {
      const hasDirectSponsored = await element.evaluate((el: Element) => {
        // Check for text content containing "Sponsored"
        const text = el.textContent || '';
        if (text.includes('Sponsored') || text.includes('sponsored')) return true;
        
        // Check for known sponsored class names
        const html = el.innerHTML.toLowerCase();
        if (html.includes('puis-sponsored') || 
            html.includes('s-sponsored') || 
            html.includes('sp-sponsored') ||
            html.includes('adplaceholder')) return true;
        
        // Check data attributes
        const attrs = Array.from(el.attributes);
        for (const attr of attrs) {
          if (attr.name.startsWith('data-sp-') || 
              attr.name.startsWith('data-ad-') ||
              attr.value.includes('sponsored')) return true;
        }
        
        return false;
      });
      
      if (hasDirectSponsored) {
        sponsored = true;
        sponsoredSignals.signalCount = 1;
        sponsoredSignals.hasSponsoredText = true;
      }
    }

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

    // Wait for lazy-loaded content - reduced for speed
    await new Promise(resolve => setTimeout(resolve, 800));
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
 * Scans ALL results to find both organic and sponsored positions
 */
function calculateRanks(
  results: ExtractedResult[],
  targetAsin: string
): ParseResult {
  let organicRankCounter = 0;
  let sponsoredRankCounter = 0;
  
  // Track both organic and sponsored ranks separately
  let foundOrganicRank: number | null = null;
  let foundSponsoredRank: number | null = null;
  let firstFoundPosition: number | null = null;
  let firstFoundResult: ExtractedResult | null = null;

  // Debug: Count sponsored vs organic
  const sponsoredCount = results.filter(r => r.isSponsored).length;
  console.log(`[Parser] Total results: ${results.length}, Sponsored: ${sponsoredCount}, Organic: ${results.length - sponsoredCount}`);

  // Scan ALL results to find both organic and sponsored positions AND get total counts
  for (const result of results) {
    const isTargetAsin = result.asin.toUpperCase() === targetAsin.toUpperCase();
    
    // Debug: Log when we find target ASIN
    if (isTargetAsin) {
      console.log(`[Parser] Found target ASIN ${result.asin} at position ${result.position}, isSponsored: ${result.isSponsored}, signals: ${result.sponsoredSignals.signalCount}`);
    }
    
    if (result.isSponsored) {
      sponsoredRankCounter++;
      // Record sponsored rank if this is our target and we haven't found it as sponsored yet
      if (isTargetAsin && foundSponsoredRank === null) {
        foundSponsoredRank = sponsoredRankCounter;
        if (firstFoundPosition === null) {
          firstFoundPosition = result.position;
          firstFoundResult = result;
        }
      }
    } else {
      organicRankCounter++;
      // Record organic rank if this is our target and we haven't found it as organic yet
      if (isTargetAsin && foundOrganicRank === null) {
        foundOrganicRank = organicRankCounter;
        if (firstFoundPosition === null) {
          firstFoundPosition = result.position;
          firstFoundResult = result;
        }
      }
    }
    // Note: We continue scanning to get accurate total counts for the page
  }

  // Total counts from this page
  const totalOrganicCount = organicRankCounter;
  const totalSponsoredCount = sponsoredRankCounter;

  // If not found at all
  if (foundOrganicRank === null && foundSponsoredRank === null) {
    return {
      found: false,
      organicRank: null,
      sponsoredRank: null,
      position: null,
      totalResults: results.length,
      totalOrganicCount,
      totalSponsoredCount,
      boundaryValidated: false,
    };
  }

  // Perform boundary validation if in boundary zone
  let boundaryValidated = true;
  if (firstFoundPosition && firstFoundResult && isInBoundaryZone(firstFoundPosition, results.length)) {
    boundaryValidated = quickValidateBoundaryResult(targetAsin, firstFoundResult.html);
    
    // If quick validation fails, do full validation
    if (!boundaryValidated) {
      const fullValidation = validateBoundaryResult(
        targetAsin,
        firstFoundResult.html,
        firstFoundPosition,
        results.length
      );
      boundaryValidated = fullValidation.isValid;
    }
  }

  // Return both organic and sponsored ranks (may have both, one, or neither for each)
  return {
    found: true,
    organicRank: foundOrganicRank,
    sponsoredRank: foundSponsoredRank,
    position: firstFoundPosition,
    totalResults: results.length,
    totalOrganicCount,
    totalSponsoredCount,
    boundaryValidated,
    isSponsored: foundSponsoredRank !== null && foundOrganicRank === null,
  };
}

/**
 * Checks if page has CAPTCHA
 */
export async function hasCaptcha(page: Page): Promise<boolean> {
  try {
    const captchaElement = await page.$(AMAZON_SELECTORS.captcha);
    const captchaForm = await page.$(AMAZON_SELECTORS.captchaForm);
    
    // Also check for common bot detection patterns
    const pageContent = await page.evaluate(() => document.body.innerText.toLowerCase());
    const isBotPage = pageContent.includes('robot') || 
                      pageContent.includes('captcha') ||
                      pageContent.includes('automated access') ||
                      pageContent.includes('unusual traffic');
    
    if (captchaElement !== null || captchaForm !== null || isBotPage) {
      console.log('[Parser] CAPTCHA or bot detection page detected');
      return true;
    }
    return false;
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
  totalOrganicCount: number;
  totalSponsoredCount: number;
  boundaryValidated: boolean;
  isSponsored?: boolean;
}
