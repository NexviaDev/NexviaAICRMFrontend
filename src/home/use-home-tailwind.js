import { useEffect, useState } from 'react';

const TAILWIND_SCRIPT_ID = 'nexvia-home-tailwind-cdn';
const TAILWIND_CONFIG_ID = 'nexvia-home-tailwind-config';

/** CDN Tailwind — .nexvia-home-root 안에서만 적용(preflight 끔 → 사이드바·CRM 스타일 깨짐/확대 방지) */
export function useHomeTailwind() {
  const [ready, setReady] = useState(() => Boolean(window.tailwind));

  useEffect(() => {
    if (window.tailwind) {
      setReady(true);
      return undefined;
    }

    let cancelled = false;

    const markReady = () => {
      if (!cancelled) setReady(true);
    };

    if (!document.getElementById(TAILWIND_CONFIG_ID)) {
      const config = document.createElement('script');
      config.id = TAILWIND_CONFIG_ID;
      config.textContent = `
        window.tailwind = window.tailwind || {};
        window.tailwind.config = {
          important: '.nexvia-home-root',
          corePlugins: { preflight: false },
          theme: {
            extend: {
              colors: {
                primary: '#2c6485',
                'on-primary': '#ffffff',
                'primary-container': '#d6e8f8',
                'on-primary-container': '#1a365d',
                secondary: '#6b5b95',
                'on-secondary': '#ffffff',
                'secondary-container': '#e4dcf6',
                'on-secondary-container': '#3d2f5c',
                tertiary: '#3d7a62',
                'on-tertiary': '#ffffff',
                background: '#ffffff',
                'on-background': '#1a2838',
                'on-surface': '#1a2838',
                'on-surface-variant': '#5f6b7a',
                'surface-container-low': '#f0f4f8',
                'surface-container-lowest': '#ffffff'
              },
              fontFamily: {
                display: ['Manrope', 'Inter', 'sans-serif']
              }
            }
          }
        };
      `;
      document.head.appendChild(config);
    }

    const existing = document.getElementById(TAILWIND_SCRIPT_ID);
    if (existing) {
      existing.addEventListener('load', markReady, { once: true });
      return () => {
        cancelled = true;
        existing.removeEventListener('load', markReady);
      };
    }

    const script = document.createElement('script');
    script.id = TAILWIND_SCRIPT_ID;
    script.src = 'https://cdn.tailwindcss.com?plugins=forms,container-queries';
    script.addEventListener('load', markReady, { once: true });
    script.addEventListener('error', markReady, { once: true });
    document.head.appendChild(script);

    return () => {
      cancelled = true;
      script.removeEventListener('load', markReady);
      script.removeEventListener('error', markReady);
    };
  }, []);

  return ready;
}
