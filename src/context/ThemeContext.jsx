import { createContext, useContext, useState, useEffect } from 'react';
import { LIGHT, DARK } from '../utils/tokens';

const ThemeContext = createContext();

export function ThemeProvider({ children }) {
  const [isDark, setIsDark] = useState(() => {
    try {
      const stored = localStorage.getItem('slot_theme');
      if (stored !== null) return stored === 'dark';
      // First visit: honour OS preference
      return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
    } catch { return false; }
  });

  const C = isDark ? DARK : LIGHT;

  function toggle() {
    setIsDark(d => {
      const next = !d;
      try { localStorage.setItem('slot_theme', next ? 'dark' : 'light'); } catch {}
      return next;
    });
  }

  // Sync bg colour to <body> and data-theme to <html> so no flash on edges
  useEffect(() => {
    document.body.style.background = C.bg;
    document.body.style.color = C.text;
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
  }, [isDark]);

  return (
    <ThemeContext.Provider value={{ C, isDark, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
