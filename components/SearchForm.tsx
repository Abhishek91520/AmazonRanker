'use client';

// ============================================
// Search Form Component
// Single lookup form with location targeting
// ============================================

import { useState } from 'react';
import { motion } from 'framer-motion';
import { SUPPORTED_LOCATIONS } from '@/lib/types';

interface SearchFormProps {
  onSubmit: (data: SearchFormData) => Promise<void>;
  isLoading: boolean;
}

export interface SearchFormData {
  asin: string;
  keyword: string;
  checkOrganic: boolean;
  checkSponsored: boolean;
  enableLocation: boolean;
  locationPincode?: string;
}

export function SearchForm({ onSubmit, isLoading }: SearchFormProps) {
  const [asin, setAsin] = useState('');
  const [keyword, setKeyword] = useState('');
  const [checkOrganic, setCheckOrganic] = useState(true);
  const [checkSponsored, setCheckSponsored] = useState(true);
  const [enableLocation, setEnableLocation] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState(SUPPORTED_LOCATIONS[0].pincode);
  const [errors, setErrors] = useState<{ asin?: string; keyword?: string }>({});

  const validateForm = (): boolean => {
    const newErrors: { asin?: string; keyword?: string } = {};

    // Validate ASIN
    const cleanAsin = asin.trim().toUpperCase();
    if (!cleanAsin) {
      newErrors.asin = 'ASIN is required';
    } else if (!/^[A-Z0-9]{10}$/.test(cleanAsin)) {
      newErrors.asin = 'ASIN must be exactly 10 alphanumeric characters';
    }

    // Validate keyword
    const cleanKeyword = keyword.trim();
    if (!cleanKeyword) {
      newErrors.keyword = 'Keyword is required';
    } else if (cleanKeyword.length < 2) {
      newErrors.keyword = 'Keyword must be at least 2 characters';
    } else if (cleanKeyword.length > 200) {
      newErrors.keyword = 'Keyword must be at most 200 characters';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) return;

    await onSubmit({
      asin: asin.trim().toUpperCase(),
      keyword: keyword.trim(),
      checkOrganic,
      checkSponsored,
      enableLocation,
      locationPincode: enableLocation ? selectedLocation : undefined,
    });
  };

  return (
    <motion.form
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      onSubmit={handleSubmit}
      className="bg-surface rounded-xl p-6 shadow-lg border border-surface-light/20"
    >
      <h2 className="text-xl font-semibold text-text-primary mb-6">
        Single ASIN Lookup
      </h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        {/* ASIN Input */}
        <div>
          <label htmlFor="asin" className="block text-sm font-medium text-text-secondary mb-2">
            ASIN
          </label>
          <input
            type="text"
            id="asin"
            value={asin}
            onChange={(e) => {
              setAsin(e.target.value.toUpperCase());
              if (errors.asin) setErrors({ ...errors, asin: undefined });
            }}
            placeholder="B0123456789"
            maxLength={10}
            className={`w-full px-4 py-3 bg-background border rounded-lg text-text-primary placeholder-text-secondary/50 transition-colors ${
              errors.asin ? 'border-error' : 'border-surface-light hover:border-accent/50'
            }`}
            disabled={isLoading}
          />
          {errors.asin && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="mt-1 text-sm text-error"
            >
              {errors.asin}
            </motion.p>
          )}
        </div>

        {/* Keyword Input */}
        <div>
          <label htmlFor="keyword" className="block text-sm font-medium text-text-secondary mb-2">
            Keyword
          </label>
          <input
            type="text"
            id="keyword"
            value={keyword}
            onChange={(e) => {
              setKeyword(e.target.value);
              if (errors.keyword) setErrors({ ...errors, keyword: undefined });
            }}
            placeholder="Enter search keyword..."
            maxLength={200}
            className={`w-full px-4 py-3 bg-background border rounded-lg text-text-primary placeholder-text-secondary/50 transition-colors ${
              errors.keyword ? 'border-error' : 'border-surface-light hover:border-accent/50'
            }`}
            disabled={isLoading}
          />
          {errors.keyword && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="mt-1 text-sm text-error"
            >
              {errors.keyword}
            </motion.p>
          )}
        </div>
      </div>

      {/* Checkboxes Row */}
      <div className="flex flex-wrap gap-6 mb-6">
        {/* Organic Checkbox */}
        <label className="flex items-center gap-2 cursor-pointer group">
          <input
            type="checkbox"
            checked={checkOrganic}
            onChange={(e) => setCheckOrganic(e.target.checked)}
            className="w-5 h-5 rounded border-surface-light bg-background text-accent focus:ring-accent focus:ring-offset-0 focus:ring-offset-background cursor-pointer"
            disabled={isLoading}
          />
          <span className="text-text-primary group-hover:text-accent transition-colors">
            Organic Rank
          </span>
        </label>

        {/* Sponsored Checkbox */}
        <label className="flex items-center gap-2 cursor-pointer group">
          <input
            type="checkbox"
            checked={checkSponsored}
            onChange={(e) => setCheckSponsored(e.target.checked)}
            className="w-5 h-5 rounded border-surface-light bg-background text-accent focus:ring-accent focus:ring-offset-0 focus:ring-offset-background cursor-pointer"
            disabled={isLoading}
          />
          <span className="text-text-primary group-hover:text-accent transition-colors">
            Sponsored Rank
          </span>
        </label>

        {/* Location Enable Checkbox */}
        <label className="flex items-center gap-2 cursor-pointer group">
          <input
            type="checkbox"
            checked={enableLocation}
            onChange={(e) => setEnableLocation(e.target.checked)}
            className="w-5 h-5 rounded border-surface-light bg-background text-accent focus:ring-accent focus:ring-offset-0 focus:ring-offset-background cursor-pointer"
            disabled={isLoading}
          />
          <span className="text-text-primary group-hover:text-accent transition-colors">
            Enable Location Targeting
          </span>
        </label>
      </div>

      {/* Location Dropdown (conditional) */}
      {enableLocation && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          className="mb-6"
        >
          <label htmlFor="location" className="block text-sm font-medium text-text-secondary mb-2">
            City
          </label>
          <select
            id="location"
            value={selectedLocation}
            onChange={(e) => setSelectedLocation(e.target.value)}
            className="w-full md:w-64 px-4 py-3 bg-background border border-surface-light rounded-lg text-text-primary cursor-pointer hover:border-accent/50 transition-colors"
            disabled={isLoading}
          >
            {SUPPORTED_LOCATIONS.map((loc) => (
              <option key={loc.pincode} value={loc.pincode}>
                {loc.name} ({loc.pincode})
              </option>
            ))}
          </select>
        </motion.div>
      )}

      {/* Submit Button */}
      <motion.button
        type="submit"
        disabled={isLoading}
        whileHover={{ scale: isLoading ? 1 : 1.02 }}
        whileTap={{ scale: isLoading ? 1 : 0.98 }}
        className={`w-full md:w-auto px-8 py-3 rounded-lg font-medium text-white transition-all ${
          isLoading
            ? 'bg-accent/50 cursor-not-allowed'
            : 'bg-accent hover:bg-accent/90 hover:shadow-lg hover:shadow-accent/20'
        }`}
      >
        {isLoading ? (
          <span className="flex items-center justify-center gap-2">
            <span className="spinner" />
            Checking Rank...
          </span>
        ) : (
          'Check Rank'
        )}
      </motion.button>
    </motion.form>
  );
}
