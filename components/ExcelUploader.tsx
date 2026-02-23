'use client';

// ============================================
// Excel Uploader Component
// Bulk upload panel with drag-and-drop
// ============================================

import { useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import * as XLSX from 'xlsx';
import { ExcelInputRow } from '@/lib/types';

interface ExcelUploaderProps {
  onUpload: (data: ExcelInputRow[]) => void;
  isProcessing: boolean;
}

export function ExcelUploader({ onUpload, isProcessing }: ExcelUploaderProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ExcelInputRow[] | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback((file: File) => {
    setError(null);
    setFileName(file.name);

    // Validate file type
    const validTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'text/csv',
    ];
    const fileExtension = file.name.split('.').pop()?.toLowerCase();

    if (!validTypes.includes(file.type) && !['xlsx', 'xls', 'csv'].includes(fileExtension || '')) {
      setError('Please upload a valid Excel file (.xlsx, .xls) or CSV file');
      setFileName(null);
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      setError('File size must be less than 5MB');
      setFileName(null);
      return;
    }

    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });

        // Get first sheet
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];

        // Convert to JSON (header: 1 returns array of arrays)
        const jsonData = XLSX.utils.sheet_to_json(worksheet, {
          header: 1,
          defval: '',
        }) as unknown[][];

        // Skip header row and parse data
        const rows: ExcelInputRow[] = [];
        const firstRow = jsonData[0] as unknown[];
        const hasHeader = isHeaderRow(firstRow?.map(String) || []);
        const startIndex = hasHeader ? 1 : 0;

        for (let i = startIndex; i < jsonData.length; i++) {
          const row = jsonData[i] as unknown[];
          if (row && row.length >= 2 && row[0] && row[1]) {
            const asin = String(row[0]).trim().toUpperCase();
            const keyword = String(row[1]).trim();

            // Validate ASIN format
            if (/^[A-Z0-9]{10}$/.test(asin) && keyword.length >= 2) {
              rows.push({ asin, keyword });
            }
          }
        }

        if (rows.length === 0) {
          setError('No valid ASIN/keyword pairs found. Ensure Column A has ASINs (10 chars) and Column B has keywords.');
          setFileName(null);
          return;
        }

        // Limit to 100 rows for performance
        if (rows.length > 100) {
          setError(`Found ${rows.length} rows. Maximum 100 rows allowed per batch.`);
          setFileName(null);
          return;
        }

        // Set preview (first 5 rows)
        setPreview(rows.slice(0, 5));
        
        // Store parsed data in state for later submission
        (window as unknown as Record<string, ExcelInputRow[]>).__excelData = rows;
      } catch (err) {
        console.error('Excel parsing error:', err);
        setError('Failed to parse Excel file. Please check the format.');
        setFileName(null);
      }
    };

    reader.onerror = () => {
      setError('Failed to read file');
      setFileName(null);
    };

    reader.readAsArrayBuffer(file);
  }, []);

  const isHeaderRow = (row: string[]): boolean => {
    if (!row || row.length < 2) return false;
    const firstCell = String(row[0]).toLowerCase();
    const secondCell = String(row[1]).toLowerCase();
    return (
      firstCell.includes('asin') ||
      firstCell.includes('product') ||
      secondCell.includes('keyword') ||
      secondCell.includes('search')
    );
  };

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);

      const files = e.dataTransfer.files;
      if (files.length > 0) {
        processFile(files[0]);
      }
    },
    [processFile]
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0) {
        processFile(files[0]);
      }
    },
    [processFile]
  );

  const handleSubmit = () => {
    const data = (window as unknown as Record<string, ExcelInputRow[] | undefined>).__excelData;
    if (data && data.length > 0) {
      onUpload(data);
      // Clear after upload
      delete (window as unknown as Record<string, ExcelInputRow[] | undefined>).__excelData;
    }
  };

  const handleClear = () => {
    setFileName(null);
    setPreview(null);
    setError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    delete (window as unknown as Record<string, ExcelInputRow[] | undefined>).__excelData;
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.1 }}
      className="bg-surface rounded-xl p-6 shadow-lg border border-surface-light/20"
    >
      <h2 className="text-xl font-semibold text-text-primary mb-4">
        Bulk Excel Upload
      </h2>

      <p className="text-text-secondary text-sm mb-4">
        Upload an Excel file with Column A: ASIN, Column B: Keyword
      </p>

      {/* Drop Zone */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`relative border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-all ${
          isDragOver
            ? 'border-accent bg-accent/10'
            : 'border-surface-light hover:border-accent/50 hover:bg-surface-light/10'
        } ${isProcessing ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          onChange={handleFileSelect}
          className="hidden"
          disabled={isProcessing}
        />

        <div className="flex flex-col items-center gap-3">
          {/* Upload Icon */}
          <svg
            className={`w-12 h-12 ${isDragOver ? 'text-accent' : 'text-text-secondary'}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
            />
          </svg>

          <div>
            <p className="text-text-primary font-medium">
              {fileName ? fileName : 'Drop Excel file here or click to browse'}
            </p>
            <p className="text-text-secondary text-sm mt-1">
              Supports .xlsx, .xls, .csv (max 100 rows, 5MB)
            </p>
          </div>
        </div>
      </div>

      {/* Error Message */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="mt-4 p-3 bg-error/10 border border-error/20 rounded-lg"
          >
            <p className="text-error text-sm">{error}</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Preview */}
      <AnimatePresence>
        {preview && preview.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-4"
          >
            <div className="flex items-center justify-between mb-2">
              <p className="text-text-secondary text-sm">
                Preview (showing first {preview.length} of{' '}
                {(window as unknown as Record<string, ExcelInputRow[] | undefined>).__excelData?.length || 0} rows)
              </p>
              <button
                onClick={handleClear}
                className="text-text-secondary hover:text-error text-sm transition-colors"
                disabled={isProcessing}
              >
                Clear
              </button>
            </div>

            <div className="bg-background rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-surface-light">
                    <th className="px-4 py-2 text-left text-text-secondary font-medium">ASIN</th>
                    <th className="px-4 py-2 text-left text-text-secondary font-medium">Keyword</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map((row, index) => (
                    <tr key={index} className="border-b border-surface-light/50 last:border-0">
                      <td className="px-4 py-2 text-text-primary font-mono">{row.asin}</td>
                      <td className="px-4 py-2 text-text-primary">{row.keyword}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Submit Button */}
            <motion.button
              onClick={handleSubmit}
              disabled={isProcessing}
              whileHover={{ scale: isProcessing ? 1 : 1.02 }}
              whileTap={{ scale: isProcessing ? 1 : 0.98 }}
              className={`mt-4 w-full px-6 py-3 rounded-lg font-medium text-white transition-all ${
                isProcessing
                  ? 'bg-accent/50 cursor-not-allowed'
                  : 'bg-accent hover:bg-accent/90 hover:shadow-lg hover:shadow-accent/20'
              }`}
            >
              {isProcessing ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="spinner" />
                  Processing...
                </span>
              ) : (
                `Start Processing ${(window as unknown as Record<string, ExcelInputRow[] | undefined>).__excelData?.length || 0} Items`
              )}
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
