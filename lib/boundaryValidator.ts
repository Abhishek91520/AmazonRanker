// ============================================
// Boundary Validation Module
// Anti false-positive validation for edge cases
// ============================================

import { SearchResultItem } from './types';

/**
 * Boundary positions that require additional validation
 * First 3 and last 3 positions on a page are high-risk
 */
const BOUNDARY_FIRST = 3;
const BOUNDARY_LAST = 3;

/**
 * Determines if a position is within boundary risk zone
 */
export function isInBoundaryZone(
  position: number,
  totalResults: number
): boolean {
  // First 3 positions
  if (position <= BOUNDARY_FIRST) {
    return true;
  }

  // Last 3 positions
  if (totalResults > 0 && position > totalResults - BOUNDARY_LAST) {
    return true;
  }

  return false;
}

/**
 * Validates a search result item found in boundary zone
 * Performs additional checks to reduce false positives
 */
export function validateBoundaryResult(
  targetAsin: string,
  elementHtml: string,
  position: number,
  totalResults: number
): BoundaryValidationResult {
  const result: BoundaryValidationResult = {
    isValid: false,
    confidence: 0,
    validationChecks: {
      asinMatch: false,
      structuralIntegrity: false,
      contentPresence: false,
      notInjection: false,
    },
  };

  // Check 1: Verify ASIN is properly embedded in data attributes
  result.validationChecks.asinMatch = verifyAsinEmbedding(targetAsin, elementHtml);

  // Check 2: Verify structural integrity of the result
  result.validationChecks.structuralIntegrity = verifyStructuralIntegrity(elementHtml);

  // Check 3: Verify essential content presence
  result.validationChecks.contentPresence = verifyContentPresence(elementHtml);

  // Check 4: Verify it's not a layout injection
  result.validationChecks.notInjection = verifyNotInjection(elementHtml, position);

  // Calculate confidence score
  const checks = Object.values(result.validationChecks);
  const passedChecks = checks.filter(Boolean).length;
  result.confidence = passedChecks / checks.length;

  // Result is valid if at least 3 out of 4 checks pass
  result.isValid = passedChecks >= 3;

  return result;
}

interface BoundaryValidationResult {
  isValid: boolean;
  confidence: number;
  validationChecks: {
    asinMatch: boolean;
    structuralIntegrity: boolean;
    contentPresence: boolean;
    notInjection: boolean;
  };
}

/**
 * Verify ASIN is embedded in standard data attributes
 */
function verifyAsinEmbedding(asin: string, html: string): boolean {
  // Check for data-asin attribute with exact match
  const dataAsinPattern = new RegExp(`data-asin=["']?${asin}["']?`, 'i');
  if (!dataAsinPattern.test(html)) {
    return false;
  }

  // Verify it's not a nested/partial reference
  const asinOccurrences = (html.match(new RegExp(asin, 'g')) || []).length;
  
  // Single occurrence is ideal, multiple might indicate cross-references
  return asinOccurrences >= 1 && asinOccurrences <= 5;
}

/**
 * Verify structural integrity of result element
 */
function verifyStructuralIntegrity(html: string): boolean {
  const requiredStructures = [
    // Product link structure
    /a[^>]*href=["'][^"']*\/dp\//i,
    // Image container
    /<img[^>]+src/i,
    // At least one interactive element
    /a[^>]*href|button|input/i,
  ];

  let passedChecks = 0;
  for (const pattern of requiredStructures) {
    if (pattern.test(html)) {
      passedChecks++;
    }
  }

  return passedChecks >= 2;
}

/**
 * Verify essential content is present
 */
function verifyContentPresence(html: string): boolean {
  const contentIndicators = [
    // Price element
    /class=["'][^"']*price[^"']*["']/i,
    // Title/heading
    /class=["'][^"']*title[^"']*["']/i,
    // Rating
    /class=["'][^"']*rating[^"']*["']/i,
    // Prime badge
    /prime/i,
    // Delivery info
    /delivery|shipping/i,
  ];

  let foundIndicators = 0;
  for (const pattern of contentIndicators) {
    if (pattern.test(html)) {
      foundIndicators++;
    }
  }

  // At least 2 content indicators should be present
  return foundIndicators >= 2;
}

/**
 * Verify element is not an injected widget/promotion
 */
function verifyNotInjection(html: string, position: number): boolean {
  const injectionPatterns = [
    // Editorial recommendations
    /editorial[_-]?reco/i,
    // Video widgets
    /video[_-]?widget/i,
    // Brand story
    /brand[_-]?story/i,
    // Deals widget
    /deals[_-]?widget/i,
    // Similar items
    /similar[_-]?items/i,
    // Related searches
    /related[_-]?search/i,
    // Frequently bought
    /frequently[_-]?bought/i,
  ];

  for (const pattern of injectionPatterns) {
    if (pattern.test(html)) {
      return false;
    }
  }

  // Check for suspiciously small content (might be placeholder)
  if (html.length < 500) {
    return false;
  }

  return true;
}

/**
 * Perform lightweight validation without full DOM parsing
 * Used for quick secondary validation
 */
export function quickValidateBoundaryResult(
  targetAsin: string,
  elementHtml: string
): boolean {
  // Quick ASIN check
  if (!elementHtml.includes(targetAsin)) {
    return false;
  }

  // Quick structure check
  if (!/<a[^>]*href/i.test(elementHtml)) {
    return false;
  }

  // Quick content check
  if (!/price|rating|title/i.test(elementHtml)) {
    return false;
  }

  return true;
}
