// ============================================
// Location Handler Module
// Simulates delivery location for Amazon.in
// ============================================

import type { Page } from 'puppeteer-core';

/**
 * Location cookie configuration for Amazon.in
 */
interface LocationCookies {
  'ubid-acbin': string;
  'session-id': string;
  'lc-acbin': string;
}

/**
 * Sets delivery location cookies for a specific pincode
 * This simulates selecting a delivery location on Amazon.in
 */
export async function setDeliveryLocation(
  page: Page,
  pincode: string
): Promise<boolean> {
  try {
    // Generate session-like values
    const timestamp = Date.now();
    const randomId = generateRandomId(17);

    // Set location-related cookies using Puppeteer's setCookie API
    await page.setCookie(
      {
        name: 'ubid-acbin',
        value: randomId,
        domain: '.amazon.in',
        path: '/',
        secure: true,
        httpOnly: true,
      },
      {
        name: 'session-id',
        value: `${timestamp}-${randomId.substring(0, 7)}`,
        domain: '.amazon.in',
        path: '/',
        secure: true,
        httpOnly: false,
      },
      {
        name: 'lc-acbin',
        value: 'en_IN',
        domain: '.amazon.in',
        path: '/',
        secure: true,
        httpOnly: false,
      }
    );

    // Try to set location via Amazon's location API
    await simulatePincodeSelection(page, pincode);

    return true;
  } catch (error) {
    console.error('Failed to set delivery location:', error);
    return false;
  }
}

/**
 * Simulates pin code selection on Amazon.in
 * This is a lightweight simulation that sets appropriate local storage
 */
async function simulatePincodeSelection(
  page: Page,
  pincode: string
): Promise<void> {
  // Set location data in local storage (used by Amazon's frontend)
  await page.evaluate((pc: string) => {
    try {
      // Amazon uses these keys for location persistence
      localStorage.setItem('glow-pincode', pc);
      localStorage.setItem('glow-validatedPincode', pc);
      localStorage.setItem('glow-locationDisplaySetting', '{"zipCode":"' + pc + '"}');
      
      // Session storage for current session
      sessionStorage.setItem('s-zipcode', pc);
    } catch (e) {
      // Silent fail - localStorage might not be available
    }
  }, pincode);
}

/**
 * Attempts full location selection via DOM interaction
 * More thorough but slower method
 */
export async function setLocationViaDOM(
  page: Page,
  pincode: string
): Promise<boolean> {
  try {
    // Click location selector
    const locationSelector = '#nav-global-location-popover-link, #glow-ingress-block';
    const locationTrigger = await page.$(locationSelector);
    
    if (!locationTrigger) {
      return false;
    }

    await locationTrigger.click();
    
    // Wait for location modal
    await page.waitForSelector('#GLUXZipUpdateInput, #GLUXZipInputSection', {
      timeout: 5000,
    });

    // Enter pincode
    const input = await page.$('#GLUXZipUpdateInput');
    if (input) {
      await input.type(pincode);
      
      // Click apply button
      const applyButton = await page.$('#GLUXZipUpdate');
      if (applyButton) {
        await applyButton.click();
        
        // Wait for location update
        await new Promise(resolve => setTimeout(resolve, 2000));
        return true;
      }
    }

    return false;
  } catch (error) {
    console.error('DOM location selection failed:', error);
    return false;
  }
}

/**
 * Generates location-aware search URL
 */
export function getLocationAwareSearchUrl(
  keyword: string,
  page: number,
  pincode?: string
): string {
  const encodedKeyword = encodeURIComponent(keyword);
  let url = `https://www.amazon.in/s?k=${encodedKeyword}&page=${page}`;
  
  // Add location parameter if provided
  if (pincode) {
    url += `&loc=${pincode}`;
  }

  return url;
}

/**
 * Generates random ID similar to Amazon session IDs
 */
function generateRandomId(length: number): string {
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Validates pincode format for India
 */
export function isValidIndianPincode(pincode: string): boolean {
  // Indian pincodes are 6 digits, first digit is 1-9
  const pincodePattern = /^[1-9][0-9]{5}$/;
  return pincodePattern.test(pincode);
}

/**
 * Gets city name from pincode (for supported cities)
 */
export function getCityFromPincode(pincode: string): string | null {
  const cityMap: Record<string, string> = {
    '400001': 'Mumbai',
    '110001': 'Delhi',
    '560001': 'Bangalore',
    '500001': 'Hyderabad',
    '600001': 'Chennai',
    '700001': 'Kolkata',
    '411001': 'Pune',
    '380001': 'Ahmedabad',
  };

  return cityMap[pincode] || null;
}
