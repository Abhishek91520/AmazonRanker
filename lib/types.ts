// ============================================
// Type Definitions for Amazon Rank Tracker
// ============================================

// Location configuration for Indian cities
export interface LocationConfig {
  name: string;
  pincode: string;
}

export const SUPPORTED_LOCATIONS: LocationConfig[] = [
  { name: 'Mumbai', pincode: '400001' },
  { name: 'Delhi', pincode: '110001' },
  { name: 'Bangalore', pincode: '560001' },
  { name: 'Hyderabad', pincode: '500001' },
  { name: 'Chennai', pincode: '600001' },
  { name: 'Kolkata', pincode: '700001' },
  { name: 'Pune', pincode: '411001' },
  { name: 'Ahmedabad', pincode: '380001' },
];

// Error codes for structured error handling
export type ErrorCode =
  | 'captcha_detected'
  | 'timeout'
  | 'parsing_failed'
  | 'asin_not_found'
  | 'unknown_error'
  | 'invalid_input'
  | 'browser_launch_failed';

// API Request payload
export interface RankCheckRequest {
  asin: string;
  keyword: string;
  checkOrganic: boolean;
  checkSponsored: boolean;
  enableLocation: boolean;
  locationPincode?: string;
}

// API Response payload
export interface RankCheckResponse {
  success: boolean;
  data?: RankResult;
  error?: {
    code: ErrorCode;
    message: string;
  };
}

// Rank result data
export interface RankResult {
  asin: string;
  keyword: string;
  organicRank: number | null;
  sponsoredRank: number | null;
  pageFound: number | null;
  positionOnPage: number | null;
  totalResultsScanned: number;
  scannedPages: number;
  timestamp: string;
}

// Search result item from Amazon
export interface SearchResultItem {
  asin: string;
  position: number;
  isSponsored: boolean;
  sponsoredSignals: SponsoredSignals;
  boundaryValidated: boolean;
}

// Sponsored detection signals
export interface SponsoredSignals {
  hasSponsoredText: boolean;
  hasBadgeContainer: boolean;
  hasAriaLabel: boolean;
  hasAdMetadata: boolean;
  signalCount: number;
}

// Job status for bulk processing
export type JobStatus = 'queued' | 'processing' | 'retrying' | 'completed' | 'failed';

// Bulk job item
export interface BulkJobItem {
  id: string;
  asin: string;
  keyword: string;
  status: JobStatus;
  result?: RankResult;
  error?: {
    code: ErrorCode;
    message: string;
  };
  retryCount: number;
  startTime?: number;
  endTime?: number;
}

// Excel row format for input
export interface ExcelInputRow {
  asin: string;
  keyword: string;
}

// Excel row format for output
export interface ExcelOutputRow {
  ASIN: string;
  KEYWORD: string;
  SPONSORED_RANK: number | string;
  ORGANIC_RANK: number | string;
  PAGE_FOUND: number | string;
  STATUS: string;
  ERROR: string;
}

// Scraper configuration
export interface ScraperConfig {
  maxPages: number;
  maxRetries: number;
  baseBackoffMs: number;
  requestTimeoutMs: number;
  navigationTimeoutMs: number;
  scrollDelayMs: number;
  enableLocation: boolean;
  locationPincode?: string;
}

// Default scraper configuration - optimized for Vercel 60s timeout
export const DEFAULT_SCRAPER_CONFIG: ScraperConfig = {
  maxPages: 2,
  maxRetries: 1,
  baseBackoffMs: 1000,
  requestTimeoutMs: 15000,
  navigationTimeoutMs: 20000,
  scrollDelayMs: 500,
  enableLocation: false,
};

// Browser configuration for anti-detection
export const BROWSER_CONFIG = {
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  viewport: {
    width: 1920,
    height: 1080,
  },
  locale: 'en-IN',
  timezone: 'Asia/Kolkata',
};

// ASIN validation regex
export const ASIN_PATTERN = /^[A-Z0-9]{10}$/;

// Keyword constraints
export const KEYWORD_CONSTRAINTS = {
  minLength: 2,
  maxLength: 200,
};

// CSS Selectors for Amazon.in
export const AMAZON_SELECTORS = {
  // Primary result container
  primaryResult: 'div[data-component-type="s-search-result"]',
  // Fallback: any element with data-asin
  fallbackResult: '[data-asin]',
  // Search results container
  searchResults: '.s-main-slot',
  // Sponsored badge selectors (multiple for resilience)
  sponsoredBadge: [
    '.puis-sponsored-label-text',
    '.s-label-popover-default',
    '[data-component-type="sp-sponsored-result"]',
    '.a-color-secondary:contains("Sponsored")',
    'span.a-text-bold:contains("Sponsored")',
  ],
  // Captcha detection
  captcha: '#captchacharacters',
  captchaForm: 'form[action*="validateCaptcha"]',
  // No results indicator
  noResults: '.s-no-outline',
};
