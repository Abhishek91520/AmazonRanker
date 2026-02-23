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

  // Try multiple selectors in order of preference
  let elements = await page.$$(AMAZON_SELECTORS.primaryResult);
  console.log(`[Parser] Primary selector found: ${elements.length}`);

  // Try mobile selector
  if (elements.length === 0) {
    elements = await page.$$(AMAZON_SELECTORS.mobileResult);
    console.log(`[Parser] Mobile selector found: ${elements.length}`);
  }

  // Fallback to data-asin selector if others fail
  if (elements.length === 0) {
    elements = await page.$$(AMAZON_SELECTORS.fallbackResult);
    console.log(`[Parser] Fallback selector found: ${elements.length}`);
  }

  // Debug: Log all elements with data-asin on page
  if (elements.length === 0) {
    const allAsins = await page.evaluate(() => {
      const els = document.querySelectorAll('[data-asin]');
      return Array.from(els).map(el => ({
        asin: el.getAttribute('data-asin'),
        tag: el.tagName,
        classes: el.className.substring(0, 50)
      })).slice(0, 10);
    });
    console.log(`[Parser] All data-asin elements: ${JSON.stringify(allAsins)}`);
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
        // Check for text content containing "Sponsored" (case sensitive for accuracy)
        const text = el.textContent || '';
        if (text.includes('Sponsored')) return 'text';
        
        // Check for known sponsored class names
        const html = el.innerHTML;
        if (/Sponsored/i.test(html)) return 'html';
        if (/puis-sponsored|s-sponsored|sp-sponsored|adplaceholder/i.test(html)) return 'class';
        
        // Check data attributes on element itself
        const attrs = Array.from(el.attributes);
        for (const attr of attrs) {
          if (attr.name.startsWith('data-sp-') || 
              attr.name.startsWith('data-ad-') ||
              /sponsored/i.test(attr.value)) return 'attr';
        }
        
        // Check for common Amazon ad markers
        if (el.querySelector('[data-component-type*="sp"]')) return 'component';
        if (el.querySelector('.s-sponsored-label-info-icon')) return 'icon';
        
        // Check cel_widget_id for sp_ prefix (sponsored product)
        const celWidget = el.getAttribute('cel_widget_id') || '';
        if (celWidget.includes('sp_') || celWidget.includes('ADSENSE')) return 'cel_widget';
        
        // Check for sponsored tracking URLs in links
        const links = el.querySelectorAll('a[href*="slredirect"], a[href*="/gp/slredirect/"], a[href*="sp_csd"]');
        if (links.length > 0) return 'sp-link';
        
        // Check for any nested element with sp data attribute
        const spElements = el.querySelectorAll('[data-sp-link], [data-csa-c-slot-id*="sp"]');
        if (spElements.length > 0) return 'sp-nested';
        
        return null;
      });
      
      if (hasDirectSponsored) {
        sponsored = true;
        sponsoredSignals.signalCount = 1;
        sponsoredSignals.hasSponsoredText = true;
        // Log for debug
        if (position <= 5) {
          console.log(`[Parser] Fallback detected sponsored at pos ${position}: ${hasDirectSponsored}`);
        }
      }
    }

    // Debug: For first 3 items, log sponsored-related HTML snippets
    if (position <= 3) {
      const sponsoredSnippets = await element.evaluate((el: Element) => {
        const html = el.innerHTML;
        // Look for any mention of 'sp' prefix or ad-related attributes
        const matches: string[] = [];
        
        // Check for sponsored text
        if (/sponsored/i.test(html)) matches.push('has-sponsored-text');
        
        // Check for sp- data attributes
        const spAttrs = el.querySelectorAll('[data-component-type*="sp"], [cel_widget_id*="sp_"]');
        if (spAttrs.length > 0) matches.push(`sp-attrs:${spAttrs.length}`);
        
        // Check for ad placement markers
        if (/adPlacement|AdHolder|sp-item|puis-sponsored/i.test(html)) matches.push('ad-markers');
        
        // Check a-row with sponsored info
        const sponsoredRow = el.querySelector('.puis-sponsored-label-info-icon, .s-sponsored-label-info-icon');
        if (sponsoredRow) matches.push('sponsored-icon');
        
        // Get first 200 chars of text to see content
        const text = (el.textContent || '').substring(0, 100).replace(/\s+/g, ' ');
        
        return { matches, text };
      });
      console.log(`[Parser] Item ${position} sponsored signals: ${JSON.stringify(sponsoredSnippets.matches)}`);
      console.log(`[Parser] Item ${position} text: ${sponsoredSnippets.text}`);
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
 * Merges two result arrays
 * Allows same ASIN to appear as both sponsored AND organic (different entries)
 * Only removes true duplicates (same ASIN with same isSponsored status)
 */
function mergeResults(
  primary: ExtractedResult[],
  secondary: ExtractedResult[]
): ExtractedResult[] {
  // Create key combining ASIN + sponsored status to allow same ASIN in both categories
  const getKey = (r: ExtractedResult) => `${r.asin}-${r.isSponsored}`;
  const keySet = new Set(primary.map(getKey));
  const merged = [...primary];

  for (const result of secondary) {
    const key = getKey(result);
    if (!keySet.has(key)) {
      merged.push(result);
      keySet.add(key);
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
