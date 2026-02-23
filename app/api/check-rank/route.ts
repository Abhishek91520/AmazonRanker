// ============================================
// API Route: Check ASIN Rank
// Serverless endpoint for Amazon.in rank checking
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { checkAsinRank } from '@/lib/scraper';
import {
  RankCheckRequest,
  RankCheckResponse,
  ASIN_PATTERN,
  KEYWORD_CONSTRAINTS,
  DEFAULT_SCRAPER_CONFIG,
} from '@/lib/types';

// Vercel serverless function configuration
export const maxDuration = 60; // Maximum 60 seconds execution
export const dynamic = 'force-dynamic';

/**
 * POST /api/check-rank
 * 
 * Request body:
 * {
 *   asin: string,
 *   keyword: string,
 *   checkOrganic?: boolean,
 *   checkSponsored?: boolean,
 *   enableLocation?: boolean,
 *   locationPincode?: string
 * }
 */
export async function POST(request: NextRequest): Promise<NextResponse<RankCheckResponse>> {
  try {
    // Parse request body
    const body = await request.json();

    // Validate request structure
    const validationError = validateRequest(body);
    if (validationError) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'invalid_input',
            message: validationError,
          },
        },
        { status: 400 }
      );
    }

    // Construct request object with defaults
    const rankRequest: RankCheckRequest = {
      asin: sanitizeAsin(body.asin),
      keyword: sanitizeKeyword(body.keyword),
      checkOrganic: body.checkOrganic !== false,
      checkSponsored: body.checkSponsored !== false,
      enableLocation: body.enableLocation === true,
      locationPincode: body.locationPincode || undefined,
    };

    // Execute rank check
    console.log(`[API] Checking rank for ASIN: ${rankRequest.asin}, Keyword: ${rankRequest.keyword}`);
    
    const result = await checkAsinRank(rankRequest, DEFAULT_SCRAPER_CONFIG);

    // Log result
    if (result.success) {
      console.log(`[API] Success - Organic: ${result.data?.organicRank}, Sponsored: ${result.data?.sponsoredRank}`);
    } else {
      console.log(`[API] Failed - Error: ${result.error?.code}`);
    }

    return NextResponse.json(result, {
      status: result.success ? 200 : 500,
    });
  } catch (error) {
    console.error('[API] Unexpected error:', error);

    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'unknown_error',
          message: 'An unexpected error occurred while processing the request.',
        },
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/check-rank
 * Health check endpoint
 */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    status: 'ok',
    message: 'Amazon Rank Tracker API is running',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
  });
}

/**
 * Validates request body
 */
function validateRequest(body: unknown): string | null {
  if (!body || typeof body !== 'object') {
    return 'Request body must be a JSON object';
  }

  const data = body as Record<string, unknown>;

  // Validate ASIN
  if (!data.asin || typeof data.asin !== 'string') {
    return 'ASIN is required and must be a string';
  }

  const asin = data.asin.trim().toUpperCase();
  if (!ASIN_PATTERN.test(asin)) {
    return 'ASIN must be exactly 10 alphanumeric characters';
  }

  // Validate keyword
  if (!data.keyword || typeof data.keyword !== 'string') {
    return 'Keyword is required and must be a string';
  }

  const keyword = data.keyword.trim();
  if (keyword.length < KEYWORD_CONSTRAINTS.minLength) {
    return `Keyword must be at least ${KEYWORD_CONSTRAINTS.minLength} characters`;
  }

  if (keyword.length > KEYWORD_CONSTRAINTS.maxLength) {
    return `Keyword must be at most ${KEYWORD_CONSTRAINTS.maxLength} characters`;
  }

  // Check for potentially malicious input
  const maliciousPatterns = [
    /<script/i,
    /javascript:/i,
    /data:/i,
    /vbscript:/i,
    /on\w+\s*=/i,
  ];

  for (const pattern of maliciousPatterns) {
    if (pattern.test(keyword)) {
      return 'Keyword contains invalid characters';
    }
  }

  // Validate location pincode if provided
  if (data.enableLocation && data.locationPincode) {
    if (typeof data.locationPincode !== 'string') {
      return 'Location pincode must be a string';
    }

    const pincode = data.locationPincode.trim();
    if (!/^[1-9][0-9]{5}$/.test(pincode)) {
      return 'Invalid Indian pincode format';
    }
  }

  return null;
}

/**
 * Sanitizes ASIN input
 */
function sanitizeAsin(asin: string): string {
  return asin.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').substring(0, 10);
}

/**
 * Sanitizes keyword input
 */
function sanitizeKeyword(keyword: string): string {
  return keyword
    .trim()
    .replace(/[<>]/g, '')
    .substring(0, KEYWORD_CONSTRAINTS.maxLength);
}
