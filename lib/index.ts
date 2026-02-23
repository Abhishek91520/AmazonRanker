// ============================================
// Library Index
// Centralized exports for all utility modules
// ============================================

// Types and configuration
export * from './types';

// Scraper engine
export { checkAsinRank, sanitizeString } from './scraper';

// Amazon parsing
export {
  parseSearchResults,
  hasCaptcha,
  hasNoResults,
  getTotalPages,
} from './amazonParser';
export type { ParseResult } from './amazonParser';

// Sponsored classification
export {
  classifySponsored,
  isSponsored,
  getSponsoredAnalysis,
} from './sponsoredClassifier';

// Boundary validation
export {
  isInBoundaryZone,
  validateBoundaryResult,
  quickValidateBoundaryResult,
} from './boundaryValidator';

// Location handling
export {
  setDeliveryLocation,
  setLocationViaDOM,
  getLocationAwareSearchUrl,
  isValidIndianPincode,
  getCityFromPincode,
} from './locationHandler';

// Retry handling
export {
  executeWithRetry,
  isRetryableError,
  calculateBackoff,
  createRetryState,
  updateRetryState,
  classifyError,
  getErrorMessage,
  createErrorResponse,
  sleep,
  DEFAULT_RETRY_CONFIG,
} from './retryHandler';
export type { RetryConfig, RetryState } from './retryHandler';
