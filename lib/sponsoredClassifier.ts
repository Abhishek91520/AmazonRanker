// ============================================
// Sponsored Classification Module
// Multi-signal weighted detection system
// ============================================

import { SponsoredSignals } from './types';

// Minimum signals required to classify as sponsored
const SPONSORED_THRESHOLD = 2;

/**
 * Analyzes DOM element for sponsored signals
 * Uses weighted multi-signal detection for accuracy
 */
export function classifySponsored(elementHtml: string): SponsoredSignals {
  const signals: SponsoredSignals = {
    hasSponsoredText: false,
    hasBadgeContainer: false,
    hasAriaLabel: false,
    hasAdMetadata: false,
    signalCount: 0,
  };

  // Signal 1: Direct "Sponsored" text nodes
  signals.hasSponsoredText = detectSponsoredText(elementHtml);

  // Signal 2: Badge container hierarchy
  signals.hasBadgeContainer = detectBadgeContainer(elementHtml);

  // Signal 3: ARIA label attributes
  signals.hasAriaLabel = detectAriaLabels(elementHtml);

  // Signal 4: Ad metadata markers
  signals.hasAdMetadata = detectAdMetadata(elementHtml);

  // Calculate total signal count
  signals.signalCount = [
    signals.hasSponsoredText,
    signals.hasBadgeContainer,
    signals.hasAriaLabel,
    signals.hasAdMetadata,
  ].filter(Boolean).length;

  return signals;
}

/**
 * Determines if element should be classified as sponsored
 * Requires multiple signals to avoid false positives
 */
export function isSponsored(signals: SponsoredSignals): boolean {
  return signals.signalCount >= SPONSORED_THRESHOLD;
}

/**
 * Signal 1: Detect sponsored text nodes
 * Looks for various "Sponsored" text patterns
 */
function detectSponsoredText(html: string): boolean {
  const sponsoredPatterns = [
    /sponsored/i,
    /प्रायोजित/i, // Hindi for "Sponsored"
    /ad\s*$/i,
    /advertisement/i,
  ];

  // Check for sponsored label classes
  const labelPatterns = [
    /puis-sponsored-label/i,
    /s-sponsored-label/i,
    /sponsored-badge/i,
    /sp-sponsored/i,
  ];

  for (const pattern of sponsoredPatterns) {
    // Look for text content, not just class names
    const textMatch = html.match(/>([^<]*sponsored[^<]*)</i);
    if (textMatch) return true;
  }

  for (const pattern of labelPatterns) {
    if (pattern.test(html)) return true;
  }

  return false;
}

/**
 * Signal 2: Detect badge container hierarchy
 * Amazon uses specific container structures for sponsored badges
 */
function detectBadgeContainer(html: string): boolean {
  const containerPatterns = [
    /s-label-popover-default/i,
    /s-label-popover-hover/i,
    /puis-label-popover/i,
    /a-declarative.*sponsored/i,
    /data-component-type="sp-sponsored/i,
  ];

  for (const pattern of containerPatterns) {
    if (pattern.test(html)) return true;
  }

  // Check for specific sponsored result container
  if (/data-component-type=["']?s-sponsored/i.test(html)) {
    return true;
  }

  return false;
}

/**
 * Signal 3: Detect ARIA label attributes
 * Accessibility markers often indicate sponsored content
 */
function detectAriaLabels(html: string): boolean {
  const ariaPatterns = [
    /aria-label=["'][^"']*sponsored[^"']*["']/i,
    /aria-describedby=["'][^"']*sponsored[^"']*["']/i,
    /role=["']?complementary["']?/i,
  ];

  for (const pattern of ariaPatterns) {
    if (pattern.test(html)) return true;
  }

  return false;
}

/**
 * Signal 4: Detect ad metadata markers
 * Hidden data attributes and metadata for ad tracking
 */
function detectAdMetadata(html: string): boolean {
  const metadataPatterns = [
    /data-ad-/i,
    /data-sp-/i,
    /data-click-el=["'][^"']*sp[^"']*["']/i,
    /data-csa-c-type=["']?sponsoredProducts["']?/i,
    /class=["'][^"']*sp-item[^"']*["']/i,
    /cel_widget_id=["'][^"']*ADSENSE[^"']*["']/i,
    /cel_widget_id=["'][^"']*sp_[^"']*["']/i,
  ];

  for (const pattern of metadataPatterns) {
    if (pattern.test(html)) return true;
  }

  // Check for Amazon's SP (Sponsored Products) markers
  if (/sp[_-]?atf|sp[_-]?btf|sp[_-]?mtf/i.test(html)) {
    return true;
  }

  return false;
}

/**
 * Debug utility: Get detailed signal breakdown
 */
export function getSponsoredAnalysis(elementHtml: string): {
  signals: SponsoredSignals;
  isSponsored: boolean;
  confidence: number;
} {
  const signals = classifySponsored(elementHtml);
  const sponsored = isSponsored(signals);
  
  // Confidence based on signal count (0-4 signals, normalized to 0-1)
  const confidence = signals.signalCount / 4;

  return {
    signals,
    isSponsored: sponsored,
    confidence,
  };
}
