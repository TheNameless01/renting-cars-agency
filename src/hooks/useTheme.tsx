import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { AppTheme } from '../../shared/types/domain.ts';

interface ThemeContextValue {
  theme: AppTheme;
  setTheme: (next: AppTheme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({
  children,
  initialTheme = 'light',
}: {
  children: ReactNode;
  initialTheme?: AppTheme;
}) {
  const [theme, setThemeState] = useState<AppTheme>(initialTheme);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [theme]);

  const setTheme = useCallback((next: AppTheme) => setThemeState(next), []);
  const toggleTheme = useCallback(() => setThemeState((p) => (p === 'light' ? 'dark' : 'light')), []);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used inside ThemeProvider');
  }
  return ctx;
}
