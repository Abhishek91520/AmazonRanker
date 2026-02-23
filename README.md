# Amazon Rank Tracker

A production-ready web application for tracking Amazon.in keyword rankings for specific ASINs. Detects both organic and sponsored positions with elite-level scraping resilience.

## Table of Contents

- [System Architecture](#system-architecture)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Scraping Methodology](#scraping-methodology)
- [Sponsored Classification](#sponsored-classification)
- [Anti-Detection Techniques](#anti-detection-techniques)
- [API Reference](#api-reference)
- [Installation](#installation)
- [Deployment on Vercel](#deployment-on-vercel)
- [Configuration](#configuration)
- [Limitations](#limitations)
- [Scaling Strategy](#scaling-strategy)
- [Troubleshooting](#troubleshooting)

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Frontend (Next.js)                        │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────────┐ │
│  │ SearchForm  │  │ ExcelUploader│  │    ResultsTable     │ │
│  │  Component  │  │   Component  │  │     Component       │ │
│  └──────┬──────┘  └──────┬───────┘  └──────────┬──────────┘ │
│         │                │                      │            │
│         └────────────────┼──────────────────────┘            │
│                          │                                   │
│               Client-Side Job Queue                          │
│         (Sequential Processing, No Parallelism)              │
└──────────────────────────┬──────────────────────────────────┘
                           │
                    HTTP POST Request
                    (One ASIN + Keyword)
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│              Serverless API Route (/api/check-rank)          │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                   Scraper Engine                      │   │
│  │  ┌─────────────┐  ┌───────────────┐  ┌────────────┐  │   │
│  │  │   Browser   │  │ Amazon Parser │  │  Sponsored │  │   │
│  │  │   Launch    │──│    Module     │──│ Classifier │  │   │
│  │  └─────────────┘  └───────────────┘  └────────────┘  │   │
│  │                                                       │   │
│  │  ┌─────────────┐  ┌───────────────┐  ┌────────────┐  │   │
│  │  │  Boundary   │  │   Location    │  │   Retry    │  │   │
│  │  │  Validator  │  │   Handler     │  │   Engine   │  │   │
│  │  └─────────────┘  └───────────────┘  └────────────┘  │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
                    JSON Response
                (Organic + Sponsored Ranks)
```

### Key Design Principles

1. **Serverless-First**: Every request is stateless and self-contained
2. **Client-Side Orchestration**: Bulk processing managed in browser
3. **Single Request = Single ASIN**: No batching at API level
4. **No Background Workers**: All processing within request lifecycle
5. **Clean Browser Lifecycle**: New browser context per retry

---

## Features

- **Single ASIN Lookup**: Quick rank check for individual products
- **Bulk Excel Upload**: Process up to 100 ASIN/keyword pairs
- **Dual Rank Detection**: Separate organic and sponsored rankings
- **Location Targeting**: 8 major Indian cities supported
- **Real-Time Progress**: Live status updates during processing
- **Excel Export**: Download results in Excel format
- **Smart Retry Engine**: Automatic retry with exponential backoff
- **Boundary Validation**: Anti false-positive protection

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 15 (App Router) |
| Language | TypeScript (Strict Mode) |
| UI | TailwindCSS |
| Animations | Framer Motion |
| Scraping | Playwright-Core |
| Browser | @sparticuz/chromium (Vercel) |
| Excel | xlsx |

---

## Scraping Methodology

### Multi-Phase Page Parsing

The scraper uses a two-phase approach to capture all results:

**Phase 1: Initial Load**
```
1. Navigate to Amazon search URL
2. Wait for DOMContentLoaded
3. Check for CAPTCHA immediately
4. Extract visible results
```

**Phase 2: Lazy Content Capture**
```
1. Scroll to page midpoint
2. Wait 1.5-2 seconds
3. Additional micro-scrolls
4. Re-extract all results
5. Merge with Phase 1 results
```

### Selector Strategy

**Primary Selector:**
```css
div[data-component-type="s-search-result"]
```

**Fallback Selector:**
```css
[data-asin]
```

The fallback handles cases where Amazon changes the component type attribute.

### Result Deduplication

Results are merged by ASIN to prevent counting duplicates that appear in both phases.

---

## Sponsored Classification

### Multi-Signal Detection System

The classifier uses 4 independent signals:

| Signal | Weight | Detection Method |
|--------|--------|------------------|
| Sponsored Text | 1 | Text content containing "Sponsored" |
| Badge Container | 1 | Specific CSS class hierarchies |
| ARIA Labels | 1 | Accessibility attributes |
| Ad Metadata | 1 | Data attributes for ad tracking |

### Classification Rule

```
IF signal_count >= 2 THEN Sponsored
ELSE Organic
```

Using multiple signals prevents false positives from:
- Layout changes
- A/B testing
- Regional variations
- Translation differences

### Signal Detection Patterns

**Sponsored Text Patterns:**
```javascript
/sponsored/i
/प्रायोजित/i  // Hindi
/advertisement/i
/puis-sponsored-label/i
```

**Badge Container Patterns:**
```javascript
/s-label-popover-default/i
/data-component-type="sp-sponsored/i
```

**Ad Metadata Patterns:**
```javascript
/data-ad-/i
/data-sp-/i
/cel_widget_id=.*ADSENSE/i
```

---

## Anti-Detection Techniques

### Browser Configuration

```typescript
{
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ...',
  viewport: { width: 1920, height: 1080 },
  locale: 'en-IN',
  timezone: 'Asia/Kolkata',
  hasTouch: false,
  isMobile: false,
}
```

### Request Interception

Blocked resource types:
- Images
- Fonts
- Media
- Stylesheets (partial)
- Analytics/tracking scripts

### Timing Randomization

```typescript
// Base delay + random jitter
await sleep(1500 + Math.random() * 500);
```

### No Parallel Execution

Each API request processes ONE ASIN only. Client handles sequencing.

---

## API Reference

### POST /api/check-rank

**Request:**
```json
{
  "asin": "B0123456789",
  "keyword": "wireless earbuds",
  "checkOrganic": true,
  "checkSponsored": true,
  "enableLocation": false,
  "locationPincode": "400001"
}
```

**Success Response:**
```json
{
  "success": true,
  "data": {
    "asin": "B0123456789",
    "keyword": "wireless earbuds",
    "organicRank": 15,
    "sponsoredRank": null,
    "pageFound": 1,
    "positionOnPage": 15,
    "totalResultsScanned": 48,
    "scannedPages": 1,
    "timestamp": "2024-01-15T10:30:00.000Z"
  }
}
```

**Error Response:**
```json
{
  "success": false,
  "error": {
    "code": "captcha_detected",
    "message": "Amazon CAPTCHA detected. The request was blocked."
  }
}
```

### Error Codes

| Code | Description |
|------|-------------|
| `captcha_detected` | Amazon blocked with CAPTCHA |
| `timeout` | Navigation/selector timeout |
| `parsing_failed` | DOM parsing failed |
| `asin_not_found` | ASIN not in top 3 pages |
| `browser_launch_failed` | Chromium launch error |
| `invalid_input` | Bad ASIN/keyword format |
| `unknown_error` | Unexpected error |

---

## Installation

### Prerequisites

- Node.js 18+ 
- npm or yarn

### Local Setup

```bash
# Clone repository
git clone <repo-url>
cd amazon-rank-tracker

# Install dependencies
npm install

# Run development server
npm run dev
```

### Environment Variables

No environment variables required for basic operation. Chromium will use local installation in development.

---

## Deployment on Vercel

### Step 1: Connect Repository

1. Go to [vercel.com](https://vercel.com)
2. Click "New Project"
3. Import your Git repository

### Step 2: Configure Build Settings

Vercel will auto-detect Next.js. Default settings work.

### Step 3: Configure Function Settings

In `vercel.json` (optional):
```json
{
  "functions": {
    "app/api/check-rank/route.ts": {
      "memory": 1024,
      "maxDuration": 60
    }
  }
}
```

### Step 4: Deploy

Click "Deploy" and wait for build completion.

### Important Notes

- Free tier allows 10-second function execution
- Pro tier allows up to 60 seconds
- Each rank check takes 10-30 seconds typically
- Consider Pro tier for production use

---

## Configuration

### Scraper Configuration

Located in `lib/types.ts`:

```typescript
export const DEFAULT_SCRAPER_CONFIG: ScraperConfig = {
  maxPages: 3,           // Maximum Amazon pages to scan
  maxRetries: 2,         // Retry attempts per request
  baseBackoffMs: 2000,   // Initial retry delay
  requestTimeoutMs: 30000,
  navigationTimeoutMs: 45000,
  scrollDelayMs: 1500,
  enableLocation: false,
};
```

### Supported Locations

```typescript
const SUPPORTED_LOCATIONS = [
  { name: 'Mumbai', pincode: '400001' },
  { name: 'Delhi', pincode: '110001' },
  { name: 'Bangalore', pincode: '560001' },
  { name: 'Hyderabad', pincode: '500001' },
  { name: 'Chennai', pincode: '600001' },
  { name: 'Kolkata', pincode: '700001' },
  { name: 'Pune', pincode: '411001' },
  { name: 'Ahmedabad', pincode: '380001' },
];
```

---

## Limitations

### Technical Limitations

1. **Vercel Function Timeout**: 60 seconds max (Pro tier)
2. **Concurrent Requests**: Sequential only (anti-detection)
3. **Pages Scanned**: Maximum 3 per request
4. **Bulk Limit**: 100 items per batch

### Amazon-Related Limitations

1. **CAPTCHA**: May occur with frequent requests
2. **IP Blocking**: Possible with high volume
3. **Layout Changes**: May require selector updates
4. **Rate Limiting**: Implicit 1-second gap recommended

### Accuracy Considerations

1. **Personalization**: Results vary by user history
2. **A/B Testing**: Amazon shows different layouts
3. **Time Sensitivity**: Rankings fluctuate constantly
4. **Location Impact**: Results differ by pincode

---

## Scaling Strategy

### For Higher Volume

**Option 1: Proxy Rotation**
```typescript
// Add to scraper configuration
const proxyList = [
  'http://proxy1:port',
  'http://proxy2:port',
];

// Rotate per request
const proxy = proxyList[Math.floor(Math.random() * proxyList.length)];
```

**Option 2: Multiple API Routes**
Create separate routes (`/api/check-rank-1`, `/api/check-rank-2`) and load balance on client.

**Option 3: Edge Functions**
Deploy to multiple Vercel regions for geographic distribution.

### For Real-Time Monitoring

Consider caching previous results:
```typescript
// Cache layer (pseudo-code)
const cache = new Map();
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes

async function getCachedRank(asin, keyword) {
  const key = `${asin}:${keyword}`;
  if (cache.has(key) && Date.now() - cache.get(key).time < CACHE_TTL) {
    return cache.get(key).data;
  }
  // Fetch fresh data...
}
```

---

## Troubleshooting

### Common Issues

#### "Browser launch failed"

**Cause**: Chromium binary not found or memory limit exceeded.

**Solutions**:
1. Ensure `@sparticuz/chromium` is installed
2. Increase Vercel function memory to 1024MB
3. Check `next.config.js` externals configuration

#### "CAPTCHA detected"

**Cause**: Amazon blocking automated requests.

**Solutions**:
1. Wait 5-10 minutes before retrying
2. Reduce request frequency
3. Consider proxy rotation
4. Implement longer delays between requests

#### "Timeout" errors

**Cause**: Amazon page loading slowly or blocked.

**Solutions**:
1. Increase `navigationTimeoutMs` in config
2. Check if Amazon.in is accessible
3. Try with location disabled

#### "Parsing failed"

**Cause**: Amazon layout changed.

**Solutions**:
1. Check if primary selector still valid
2. Update selectors in `lib/types.ts`
3. Enable fallback selectors

#### Excel upload not working

**Cause**: File format or content issues.

**Solutions**:
1. Ensure Column A = ASIN, Column B = Keyword
2. ASIN must be exactly 10 characters
3. Maximum 100 rows allowed
4. File must be under 5MB

### Debug Mode

Add to API route for debugging:
```typescript
console.log('[DEBUG] Page HTML:', await page.content());
console.log('[DEBUG] Results found:', results.length);
```

### Health Check

```bash
curl https://your-domain.vercel.app/api/check-rank
```

Expected response:
```json
{
  "status": "ok",
  "message": "Amazon Rank Tracker API is running",
  "version": "1.0.0"
}
```

---

## Project Structure

```
/amazon-rank-tracker
├── app/
│   ├── api/
│   │   └── check-rank/
│   │       └── route.ts       # API endpoint
│   ├── dashboard/
│   │   └── page.tsx           # Main UI
│   ├── globals.css            # Global styles
│   ├── layout.tsx             # Root layout
│   └── page.tsx               # Redirect to dashboard
│
├── components/
│   ├── SearchForm.tsx         # Single lookup form
│   ├── ExcelUploader.tsx      # Bulk upload panel
│   ├── ResultsTable.tsx       # Results display
│   └── ProgressBar.tsx        # Progress indicator
│
├── lib/
│   ├── types.ts               # Type definitions
│   ├── scraper.ts             # Main scraper engine
│   ├── amazonParser.ts        # DOM parsing logic
│   ├── sponsoredClassifier.ts # Sponsored detection
│   ├── boundaryValidator.ts   # False-positive prevention
│   ├── locationHandler.ts     # Location simulation
│   └── retryHandler.ts        # Retry logic
│
├── next.config.js
├── tailwind.config.js
├── tsconfig.json
└── package.json
```

---

## License

MIT License - See LICENSE file for details.

---

## Disclaimer

This tool is for educational and personal use only. Automated scraping of Amazon may violate their Terms of Service. Use responsibly and at your own risk.
