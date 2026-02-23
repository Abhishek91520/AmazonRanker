'use client';

// ============================================
// Dashboard Page
// Main application interface
// ============================================

import { useState, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import { SearchForm, SearchFormData } from '@/components/SearchForm';
import { ExcelUploader } from '@/components/ExcelUploader';
import { ResultsTable } from '@/components/ResultsTable';
import { ProgressBar } from '@/components/ProgressBar';
import {
  BulkJobItem,
  ExcelInputRow,
  RankCheckResponse,
  ErrorCode,
} from '@/lib/types';

export default function DashboardPage() {
  const [jobs, setJobs] = useState<BulkJobItem[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [singleLookupLoading, setSingleLookupLoading] = useState(false);
  const processingRef = useRef(false);

  // Generate unique ID
  const generateId = () => `job-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  // Handle single ASIN lookup
  const handleSingleLookup = useCallback(async (data: SearchFormData) => {
    setSingleLookupLoading(true);

    const job: BulkJobItem = {
      id: generateId(),
      asin: data.asin,
      keyword: data.keyword,
      status: 'processing',
      retryCount: 0,
      startTime: Date.now(),
    };

    // Add to jobs list
    setJobs((prev) => [job, ...prev]);

    try {
      const response = await fetch('/api/check-rank', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          asin: data.asin,
          keyword: data.keyword,
          checkOrganic: data.checkOrganic,
          checkSponsored: data.checkSponsored,
          enableLocation: data.enableLocation,
          locationPincode: data.locationPincode,
        }),
      });

      const result: RankCheckResponse = await response.json();

      setJobs((prev) =>
        prev.map((j) =>
          j.id === job.id
            ? {
                ...j,
                status: result.success ? 'completed' : 'failed',
                result: result.data,
                error: result.error,
                endTime: Date.now(),
              }
            : j
        )
      );
    } catch (error) {
      setJobs((prev) =>
        prev.map((j) =>
          j.id === job.id
            ? {
                ...j,
                status: 'failed',
                error: {
                  code: 'unknown_error' as ErrorCode,
                  message: 'Network error. Please try again.',
                },
                endTime: Date.now(),
              }
            : j
        )
      );
    } finally {
      setSingleLookupLoading(false);
    }
  }, []);

  // Handle bulk Excel upload
  const handleBulkUpload = useCallback(async (data: ExcelInputRow[]) => {
    if (processingRef.current) return;

    processingRef.current = true;
    setIsProcessing(true);

    // Create job items
    const newJobs: BulkJobItem[] = data.map((row) => ({
      id: generateId(),
      asin: row.asin,
      keyword: row.keyword,
      status: 'queued' as const,
      retryCount: 0,
    }));

    setJobs((prev) => [...newJobs, ...prev]);

    // Process sequentially
    for (let i = 0; i < newJobs.length; i++) {
      if (!processingRef.current) break;

      const job = newJobs[i];

      // Update status to processing
      setJobs((prev) =>
        prev.map((j) =>
          j.id === job.id ? { ...j, status: 'processing', startTime: Date.now() } : j
        )
      );

      // Attempt with retry logic
      let retryCount = 0;
      const maxRetries = 2;
      let success = false;

      while (retryCount <= maxRetries && !success) {
        if (retryCount > 0) {
          // Update status to retrying
          setJobs((prev) =>
            prev.map((j) =>
              j.id === job.id ? { ...j, status: 'retrying', retryCount } : j
            )
          );

          // Wait before retry (exponential backoff)
          await new Promise((resolve) => setTimeout(resolve, 2000 * Math.pow(2, retryCount - 1)));
        }

        try {
          const response = await fetch('/api/check-rank', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              asin: job.asin,
              keyword: job.keyword,
              checkOrganic: true,
              checkSponsored: true,
              enableLocation: false,
            }),
          });

          const result: RankCheckResponse = await response.json();

          if (result.success) {
            setJobs((prev) =>
              prev.map((j) =>
                j.id === job.id
                  ? {
                      ...j,
                      status: 'completed',
                      result: result.data,
                      endTime: Date.now(),
                    }
                  : j
              )
            );
            success = true;
          } else {
            // Check if error is retryable
            const retryableErrors: ErrorCode[] = ['captcha_detected', 'timeout', 'parsing_failed'];
            if (result.error && !retryableErrors.includes(result.error.code)) {
              // Non-retryable error
              setJobs((prev) =>
                prev.map((j) =>
                  j.id === job.id
                    ? {
                        ...j,
                        status: 'failed',
                        error: result.error,
                        endTime: Date.now(),
                      }
                    : j
                )
              );
              success = true; // Exit retry loop
            } else {
              retryCount++;
            }
          }
        } catch {
          retryCount++;
        }
      }

      // If all retries failed
      if (!success) {
        setJobs((prev) =>
          prev.map((j) =>
            j.id === job.id
              ? {
                  ...j,
                  status: 'failed',
                  error: {
                    code: 'unknown_error' as ErrorCode,
                    message: 'Max retries exceeded',
                  },
                  retryCount,
                  endTime: Date.now(),
                }
              : j
          )
        );
      }

      // Small delay between items to avoid rate limiting
      if (i < newJobs.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    processingRef.current = false;
    setIsProcessing(false);
  }, []);

  // Calculate progress stats
  const completedCount = jobs.filter((j) => j.status === 'completed').length;
  const failedCount = jobs.filter((j) => j.status === 'failed').length;
  const hasResults = jobs.some((j) => j.status === 'completed' || j.status === 'failed');

  // Handle stop processing
  const handleStopProcessing = useCallback(() => {
    processingRef.current = false;
    setIsProcessing(false);
  }, []);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <motion.header
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-surface border-b border-surface-light/20"
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {/* Logo */}
              <div className="w-10 h-10 rounded-lg bg-accent flex items-center justify-center">
                <svg
                  className="w-6 h-6 text-white"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                  />
                </svg>
              </div>

              <div>
                <h1 className="text-xl font-bold text-text-primary">
                  Amazon Rank Tracker
                </h1>
                <p className="text-sm text-text-secondary">
                  Amazon.in Keyword Ranking Analysis
                </p>
              </div>
            </div>

            {/* Stop button when processing */}
            {isProcessing && (
              <motion.button
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                onClick={handleStopProcessing}
                className="px-4 py-2 bg-error hover:bg-error/90 rounded-lg text-white text-sm font-medium transition-colors"
              >
                Stop Processing
              </motion.button>
            )}
          </div>
        </div>
      </motion.header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="space-y-6">
          {/* Top Section: Search Form */}
          <SearchForm onSubmit={handleSingleLookup} isLoading={singleLookupLoading} />

          {/* Middle Section: Excel Uploader */}
          <ExcelUploader onUpload={handleBulkUpload} isProcessing={isProcessing} />

          {/* Progress Bar (only shown during bulk processing) */}
          {jobs.length > 0 && (isProcessing || hasResults) && (
            <ProgressBar
              total={jobs.length}
              completed={completedCount}
              failed={failedCount}
              processing={isProcessing}
            />
          )}

          {/* Results Table */}
          <ResultsTable
            jobs={jobs}
            onDownload={() => {}}
            hasResults={hasResults}
          />
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-surface-light/20 mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <p className="text-center text-sm text-text-secondary">
            Amazon Rank Tracker v1.0.0 - Built for Amazon.in
          </p>
        </div>
      </footer>
    </div>
  );
}
