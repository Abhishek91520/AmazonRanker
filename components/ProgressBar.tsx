'use client';

// ============================================
// Progress Bar Component
// Animated progress indicator for bulk processing
// ============================================

import { motion } from 'framer-motion';

interface ProgressBarProps {
  total: number;
  completed: number;
  failed: number;
  processing: boolean;
}

export function ProgressBar({ total, completed, failed, processing }: ProgressBarProps) {
  const successPercentage = total > 0 ? (completed / total) * 100 : 0;
  const failedPercentage = total > 0 ? (failed / total) * 100 : 0;
  const remainingPercentage = 100 - successPercentage - failedPercentage;

  const formatTime = (seconds: number): string => {
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  };

  const estimatedTimePerItem = 15; // Average seconds per item
  const remaining = total - completed - failed;
  const estimatedTime = remaining * estimatedTimePerItem;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-surface rounded-xl p-5 shadow-lg border border-surface-light/20"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-medium text-text-primary">
          Processing Progress
        </h3>
        {processing && (
          <motion.span
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex items-center gap-2 text-sm text-text-secondary"
          >
            <span className="spinner" />
            {remaining > 0 && `~${formatTime(estimatedTime)} remaining`}
          </motion.span>
        )}
      </div>

      {/* Progress Bar */}
      <div className="h-3 bg-background rounded-full overflow-hidden mb-4">
        <div className="h-full flex">
          {/* Success portion */}
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${successPercentage}%` }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
            className="h-full bg-success"
          />
          {/* Failed portion */}
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${failedPercentage}%` }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
            className="h-full bg-error"
          />
          {/* Processing animation */}
          {processing && remainingPercentage > 0 && (
            <motion.div
              animate={{
                opacity: [0.3, 0.7, 0.3],
              }}
              transition={{
                duration: 1.5,
                repeat: Infinity,
                ease: 'easeInOut',
              }}
              className="h-full bg-accent"
              style={{ width: `${Math.min(5, remainingPercentage)}%` }}
            />
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-6">
          {/* Completed */}
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-success" />
            <span className="text-text-secondary">
              Completed: <span className="text-text-primary font-medium">{completed}</span>
            </span>
          </div>

          {/* Failed */}
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-error" />
            <span className="text-text-secondary">
              Failed: <span className="text-text-primary font-medium">{failed}</span>
            </span>
          </div>

          {/* Remaining */}
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-surface-light" />
            <span className="text-text-secondary">
              Remaining: <span className="text-text-primary font-medium">{remaining}</span>
            </span>
          </div>
        </div>

        {/* Percentage */}
        <div className="text-text-primary font-semibold">
          {Math.round(successPercentage + failedPercentage)}%
        </div>
      </div>
    </motion.div>
  );
}
