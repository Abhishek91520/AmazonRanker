// ============================================
// Retry Handler Module
// Smart retry engine with exponential backoff
// ============================================

import { ErrorCode } from './types';

/**
 * Retry configuration
 */
export interface RetryConfig {
  maxRetries: number;
  baseBackoffMs: number;
  maxBackoffMs: number;
  retryableErrors: ErrorCode[];
}

/**
 * Default retry configuration
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 2,
  baseBackoffMs: 2000,
  maxBackoffMs: 8000,
  retryableErrors: ['captcha_detected', 'timeout', 'parsing_failed'],
};

/**
 * Retry state tracking
 */
export interface RetryState {
  attempt: number;
  lastError: ErrorCode | null;
  totalDelayMs: number;
  shouldRetry: boolean;
}

/**
 * Determines if an error is retryable
 */
export function isRetryableError(
  errorCode: ErrorCode,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): boolean {
  return config.retryableErrors.includes(errorCode);
}

/**
 * Calculates backoff delay for current attempt
 * Uses exponential backoff: base * 2^attempt
 */
export function calculateBackoff(
  attempt: number,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): number {
  const exponentialDelay = config.baseBackoffMs * Math.pow(2, attempt);
  
  // Add small random jitter (0-500ms) to prevent thundering herd
  const jitter = Math.floor(Math.random() * 500);
  
  const totalDelay = exponentialDelay + jitter;
  
  // Cap at maximum backoff
  return Math.min(totalDelay, config.maxBackoffMs);
}

/**
 * Creates initial retry state
 */
export function createRetryState(): RetryState {
  return {
    attempt: 0,
    lastError: null,
    totalDelayMs: 0,
    shouldRetry: false,
  };
}

/**
 * Updates retry state after an error
 */
export function updateRetryState(
  state: RetryState,
  errorCode: ErrorCode,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): RetryState {
  const newAttempt = state.attempt + 1;
  const shouldRetry = 
    isRetryableError(errorCode, config) && 
    newAttempt <= config.maxRetries;

  const backoffDelay = shouldRetry ? calculateBackoff(newAttempt - 1, config) : 0;

  return {
    attempt: newAttempt,
    lastError: errorCode,
    totalDelayMs: state.totalDelayMs + backoffDelay,
    shouldRetry,
  };
}

/**
 * Sleep utility with minimum overhead
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Executes an async function with retry logic
 */
export async function executeWithRetry<T>(
  fn: () => Promise<T>,
  onRetry?: (state: RetryState, error: Error) => void,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): Promise<{ result: T; retryState: RetryState } | { error: ErrorCode; retryState: RetryState }> {
  let state = createRetryState();

  while (true) {
    try {
      const result = await fn();
      return { result, retryState: state };
    } catch (error) {
      const errorCode = classifyError(error);
      state = updateRetryState(state, errorCode, config);

      if (!state.shouldRetry) {
        return { error: errorCode, retryState: state };
      }

      // Notify about retry
      if (onRetry) {
        onRetry(state, error as Error);
      }

      // Wait before retry
      const backoffDelay = calculateBackoff(state.attempt - 1, config);
      await sleep(backoffDelay);
    }
  }
}

/**
 * Classifies an error into an ErrorCode
 */
export function classifyError(error: unknown): ErrorCode {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();

    // Captcha detection
    if (
      message.includes('captcha') ||
      message.includes('robot') ||
      message.includes('automated')
    ) {
      return 'captcha_detected';
    }

    // Timeout errors
    if (
      message.includes('timeout') ||
      message.includes('timed out') ||
      message.includes('navigation')
    ) {
      return 'timeout';
    }

    // Parsing errors
    if (
      message.includes('parse') ||
      message.includes('selector') ||
      message.includes('element not found')
    ) {
      return 'parsing_failed';
    }

    // Browser errors
    if (
      message.includes('browser') ||
      message.includes('chromium') ||
      message.includes('launch')
    ) {
      return 'browser_launch_failed';
    }

    // ASIN not found
    if (message.includes('asin not found') || message.includes('not found in results')) {
      return 'asin_not_found';
    }
  }

  return 'unknown_error';
}

/**
 * Gets human-readable error message
 */
export function getErrorMessage(code: ErrorCode): string {
  const messages: Record<ErrorCode, string> = {
    captcha_detected: 'Amazon CAPTCHA detected. The request was blocked.',
    timeout: 'Request timed out. Amazon may be slow or unreachable.',
    parsing_failed: 'Failed to parse search results. Amazon layout may have changed.',
    asin_not_found: 'ASIN not found in search results within scanned pages.',
    browser_launch_failed: 'Failed to launch browser. Server resource issue.',
    invalid_input: 'Invalid input provided. Check ASIN and keyword format.',
    unknown_error: 'An unexpected error occurred.',
  };

  return messages[code] || messages.unknown_error;
}

/**
 * Creates error response object
 */
export function createErrorResponse(code: ErrorCode) {
  return {
    success: false,
    error: {
      code,
      message: getErrorMessage(code),
    },
  };
}
