'use client';

// ============================================
// Results Table Component
// Live processing table with status indicators
// ============================================

import { motion, AnimatePresence } from 'framer-motion';
import { BulkJobItem, JobStatus } from '@/lib/types';
import * as XLSX from 'xlsx';

interface ResultsTableProps {
  jobs: BulkJobItem[];
  onDownload: () => void;
  hasResults: boolean;
}

export function ResultsTable({ jobs, onDownload, hasResults }: ResultsTableProps) {
  const getStatusBadge = (status: JobStatus, retryCount: number) => {
    const baseClasses = 'status-badge inline-flex items-center gap-1.5';

    switch (status) {
      case 'queued':
        return (
          <span className={`${baseClasses} status-queued`}>
            <span className="w-1.5 h-1.5 rounded-full bg-text-secondary" />
            Queued
          </span>
        );
      case 'processing':
        return (
          <span className={`${baseClasses} status-processing`}>
            <span className="spinner !w-3 !h-3" />
            Processing
          </span>
        );
      case 'retrying':
        return (
          <span className={`${baseClasses} status-retrying`}>
            <span className="spinner !w-3 !h-3 !border-warning !border-l-transparent" />
            Retry {retryCount}
          </span>
        );
      case 'completed':
        return (
          <span className={`${baseClasses} status-completed`}>
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            Completed
          </span>
        );
      case 'failed':
        return (
          <span className={`${baseClasses} status-failed`}>
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
            Failed
          </span>
        );
    }
  };

  const formatRank = (rank: number | null | undefined): string => {
    if (rank === null || rank === undefined) return '-';
    return `#${rank}`;
  };

  const handleDownloadExcel = () => {
    // Prepare data for Excel
    const data = jobs.map((job) => ({
      ASIN: job.asin,
      KEYWORD: job.keyword,
      SPONSORED_RANK: job.result?.sponsoredRank ?? 'Not Found',
      ORGANIC_RANK: job.result?.organicRank ?? 'Not Found',
      PAGE_FOUND: job.result?.pageFound ?? '-',
      STATUS: job.status,
      ERROR: job.error?.message ?? '',
    }));

    // Create workbook
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Results');

    // Style header row
    const headerRange = XLSX.utils.decode_range(ws['!ref'] || 'A1:G1');
    for (let col = headerRange.s.c; col <= headerRange.e.c; col++) {
      const cellAddress = XLSX.utils.encode_cell({ r: 0, c: col });
      if (ws[cellAddress]) {
        ws[cellAddress].s = {
          font: { bold: true },
          fill: { fgColor: { rgb: '2563EB' } },
        };
      }
    }

    // Set column widths
    ws['!cols'] = [
      { wch: 12 }, // ASIN
      { wch: 30 }, // KEYWORD
      { wch: 15 }, // SPONSORED_RANK
      { wch: 15 }, // ORGANIC_RANK
      { wch: 12 }, // PAGE_FOUND
      { wch: 12 }, // STATUS
      { wch: 30 }, // ERROR
    ];

    // Download
    const timestamp = new Date().toISOString().split('T')[0];
    XLSX.writeFile(wb, `amazon-rank-results-${timestamp}.xlsx`);
    onDownload();
  };

  if (jobs.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="bg-surface rounded-xl p-8 text-center border border-surface-light/20"
      >
        <svg
          className="w-16 h-16 mx-auto text-text-secondary/50 mb-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1}
            d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
          />
        </svg>
        <p className="text-text-secondary">
          No results yet. Use the single lookup form or upload an Excel file to get started.
        </p>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="bg-surface rounded-xl shadow-lg border border-surface-light/20 overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-surface-light/20">
        <h3 className="text-lg font-medium text-text-primary">
          Results ({jobs.length} items)
        </h3>
        {hasResults && (
          <motion.button
            onClick={handleDownloadExcel}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className="flex items-center gap-2 px-4 py-2 bg-accent hover:bg-accent/90 rounded-lg text-white text-sm font-medium transition-colors"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
              />
            </svg>
            Download Excel
          </motion.button>
        )}
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-background/50">
              <th className="px-4 py-3 text-left text-text-secondary font-medium">#</th>
              <th className="px-4 py-3 text-left text-text-secondary font-medium">ASIN</th>
              <th className="px-4 py-3 text-left text-text-secondary font-medium">Keyword</th>
              <th className="px-4 py-3 text-center text-text-secondary font-medium">Organic</th>
              <th className="px-4 py-3 text-center text-text-secondary font-medium">Sponsored</th>
              <th className="px-4 py-3 text-center text-text-secondary font-medium">Page</th>
              <th className="px-4 py-3 text-left text-text-secondary font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            <AnimatePresence mode="popLayout">
              {jobs.map((job, index) => (
                <motion.tr
                  key={job.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  transition={{ duration: 0.2 }}
                  className={`border-b border-surface-light/20 last:border-0 ${
                    job.status === 'processing' ? 'bg-accent/5' : ''
                  } ${job.status === 'completed' ? 'bg-success/5' : ''} ${
                    job.status === 'failed' ? 'bg-error/5' : ''
                  }`}
                >
                  <td className="px-4 py-3 text-text-secondary">{index + 1}</td>
                  <td className="px-4 py-3 font-mono text-text-primary">{job.asin}</td>
                  <td className="px-4 py-3 text-text-primary max-w-[200px] truncate" title={job.keyword}>
                    {job.keyword}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {job.status === 'completed' ? (
                      <span
                        className={`font-semibold ${
                          job.result?.organicRank ? 'text-success' : 'text-text-secondary'
                        }`}
                      >
                        {formatRank(job.result?.organicRank)}
                      </span>
                    ) : (
                      <span className="text-text-secondary">-</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {job.status === 'completed' ? (
                      <span
                        className={`font-semibold ${
                          job.result?.sponsoredRank ? 'text-accent' : 'text-text-secondary'
                        }`}
                      >
                        {formatRank(job.result?.sponsoredRank)}
                      </span>
                    ) : (
                      <span className="text-text-secondary">-</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center text-text-primary">
                    {job.result?.pageFound ?? '-'}
                  </td>
                  <td className="px-4 py-3">
                    {getStatusBadge(job.status, job.retryCount)}
                    {job.error && job.status === 'failed' && (
                      <p className="text-xs text-error mt-1 truncate max-w-[150px]" title={job.error.message}>
                        {job.error.message}
                      </p>
                    )}
                  </td>
                </motion.tr>
              ))}
            </AnimatePresence>
          </tbody>
        </table>
      </div>
    </motion.div>
  );
}
