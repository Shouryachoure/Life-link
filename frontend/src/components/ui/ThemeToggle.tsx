import React, { useState, useRef, useEffect } from 'react';
import { useTheme, type ThemeMode } from '../../context/ThemeContext';
import { Sun, Moon, Laptop, ChevronDown, Check } from 'lucide-react';

interface ThemeToggleProps {
  variant?: 'segmented' | 'dropdown' | 'icon-toggle';
  className?: string;
}

export const ThemeToggle: React.FC<ThemeToggleProps> = ({ variant = 'segmented', className = '' }) => {
  const { mode, theme, setMode, toggleTheme } = useTheme();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (variant === 'icon-toggle') {
    return (
      <button
        type="button"
        onClick={toggleTheme}
        aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
        className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all border border-slate-200/80 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100/70 dark:hover:bg-slate-800 shadow-sm backdrop-blur-sm cursor-pointer ${className}`}
      >
        {theme === 'dark' ? <Moon className="w-4 h-4 text-sky-400" /> : <Sun className="w-4 h-4 text-amber-500" />}
      </button>
    );
  }

  if (variant === 'dropdown') {
    return (
      <div className={`relative inline-block text-left ${className}`} ref={dropdownRef}>
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          aria-haspopup="true"
          aria-expanded={isOpen}
          aria-label="Select color theme"
          className="inline-flex items-center gap-2 h-9 px-3 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/60 shadow-sm transition-colors cursor-pointer"
        >
          {mode === 'light' && <Sun className="w-3.5 h-3.5 text-amber-500" />}
          {mode === 'dark' && <Moon className="w-3.5 h-3.5 text-sky-400" />}
          {mode === 'system' && <Laptop className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />}
          <span className="capitalize">{mode}</span>
          <ChevronDown className="w-3 h-3 text-slate-400" />
        </button>

        {isOpen && (
          <div className="absolute right-0 mt-2 w-36 origin-top-right rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-xl shadow-slate-950/10 p-1.5 z-50 text-xs">
            <button
              type="button"
              onClick={() => {
                setMode('light');
                setIsOpen(false);
              }}
              className={`w-full flex items-center justify-between px-2.5 py-2 rounded-xl transition-colors cursor-pointer ${
                mode === 'light'
                  ? 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-bold'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50'
              }`}
            >
              <span className="flex items-center gap-2">
                <Sun className="w-3.5 h-3.5 text-amber-500" />
                <span>Light</span>
              </span>
              {mode === 'light' && <Check className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />}
            </button>

            <button
              type="button"
              onClick={() => {
                setMode('dark');
                setIsOpen(false);
              }}
              className={`w-full flex items-center justify-between px-2.5 py-2 rounded-xl transition-colors cursor-pointer ${
                mode === 'dark'
                  ? 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-bold'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50'
              }`}
            >
              <span className="flex items-center gap-2">
                <Moon className="w-3.5 h-3.5 text-sky-400" />
                <span>Dark</span>
              </span>
              {mode === 'dark' && <Check className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />}
            </button>

            <button
              type="button"
              onClick={() => {
                setMode('system');
                setIsOpen(false);
              }}
              className={`w-full flex items-center justify-between px-2.5 py-2 rounded-xl transition-colors cursor-pointer ${
                mode === 'system'
                  ? 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-bold'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50'
              }`}
            >
              <span className="flex items-center gap-2">
                <Laptop className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
                <span>System</span>
              </span>
              {mode === 'system' && <Check className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />}
            </button>
          </div>
        )}
      </div>
    );
  }

  // Default: Segmented Control
  return (
    <div
      role="group"
      aria-label="Color Theme Selection"
      className={`inline-flex items-center p-1 rounded-2xl bg-slate-100/90 dark:bg-slate-800/90 border border-slate-200/80 dark:border-slate-700/60 shadow-inner ${className}`}
    >
      <button
        type="button"
        onClick={() => setMode('light')}
        aria-label="Set light theme"
        title="Light Mode"
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
          mode === 'light'
            ? 'bg-white text-slate-900 shadow-sm shadow-slate-950/5 font-bold'
            : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
        }`}
      >
        <Sun className={`w-3.5 h-3.5 ${mode === 'light' ? 'text-amber-500' : ''}`} />
        <span className="hidden sm:inline">Light</span>
      </button>

      <button
        type="button"
        onClick={() => setMode('dark')}
        aria-label="Set dark theme"
        title="Dark Mode"
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
          mode === 'dark'
            ? 'bg-slate-900 text-slate-100 shadow-sm shadow-black/20 font-bold'
            : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
        }`}
      >
        <Moon className={`w-3.5 h-3.5 ${mode === 'dark' ? 'text-sky-400' : ''}`} />
        <span className="hidden sm:inline">Dark</span>
      </button>

      <button
        type="button"
        onClick={() => setMode('system')}
        aria-label="Set system theme"
        title="System Preference"
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
          mode === 'system'
            ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm font-bold'
            : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
        }`}
      >
        <Laptop className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">System</span>
      </button>
    </div>
  );
};
