import React, { useRef, useEffect } from 'react';

interface OtpInputProps {
  value: string;
  onChange: (code: string) => void;
  length?: number;
  disabled?: boolean;
  hasError?: boolean;
  autoFocus?: boolean;
}

export const OtpInput: React.FC<OtpInputProps> = ({
  value,
  onChange,
  length = 6,
  disabled = false,
  hasError = false,
  autoFocus = true,
}) => {
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Split value into array of length
  const digits = Array.from({ length }, (_, i) => value[i] || '');

  useEffect(() => {
    if (autoFocus && inputRefs.current[0] && !disabled) {
      inputRefs.current[0].focus();
    }
  }, [autoFocus, disabled]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>, index: number) => {
    const rawVal = e.target.value;
    const digit = rawVal.replace(/\D/g, '').slice(-1);

    const newDigits = [...digits];
    newDigits[index] = digit;
    const newCode = newDigits.join('');
    onChange(newCode);

    // Auto-advance to next input if digit was entered
    if (digit && index < length - 1) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, index: number) => {
    if (e.key === 'Backspace') {
      if (!digits[index] && index > 0) {
        // Move back and clear previous
        inputRefs.current[index - 1]?.focus();
        const newDigits = [...digits];
        newDigits[index - 1] = '';
        onChange(newDigits.join(''));
        e.preventDefault();
      }
    } else if (e.key === 'ArrowLeft' && index > 0) {
      inputRefs.current[index - 1]?.focus();
      e.preventDefault();
    } else if (e.key === 'ArrowRight' && index < length - 1) {
      inputRefs.current[index + 1]?.focus();
      e.preventDefault();
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pastedData = e.clipboardData.getData('text').trim();
    const cleanDigits = pastedData.replace(/\D/g, '').slice(0, length);

    if (cleanDigits) {
      onChange(cleanDigits);
      // Focus on next empty input or last input
      const nextIndex = Math.min(cleanDigits.length, length - 1);
      inputRefs.current[nextIndex]?.focus();
    }
  };

  return (
    <div className="flex items-center justify-center gap-2 sm:gap-3 my-4" role="group" aria-label="One-time verification code">
      {Array.from({ length }).map((_, index) => {
        const isCurrent = digits[index] !== '';
        return (
          <input
            key={index}
            ref={(el) => {
              inputRefs.current[index] = el;
            }}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={1}
            value={digits[index]}
            disabled={disabled}
            onChange={(e) => handleInputChange(e, index)}
            onKeyDown={(e) => handleKeyDown(e, index)}
            onPaste={handlePaste}
            onFocus={(e) => e.target.select()}
            aria-label={`Digit ${index + 1} of ${length}`}
            className={`w-11 h-14 sm:w-13 sm:h-16 text-center text-2xl font-bold font-mono rounded-xl transition-all outline-none select-none
              ${
                disabled
                  ? 'bg-slate-100 dark:bg-slate-800 text-slate-400 border-slate-200 dark:border-slate-700 cursor-not-allowed'
                  : hasError
                  ? 'bg-rose-50/50 dark:bg-rose-950/30 text-rose-600 dark:text-rose-400 border-2 border-rose-500 shadow-sm shadow-rose-500/10 focus:ring-4 focus:ring-rose-500/20'
                  : isCurrent
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 border-2 border-teal-600 dark:border-teal-500 shadow-sm shadow-teal-500/10 focus:ring-4 focus:ring-teal-500/20'
                  : 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 focus:border-teal-500 focus:ring-4 focus:ring-teal-500/20'
              }
            `}
          />
        );
      })}
    </div>
  );
};
