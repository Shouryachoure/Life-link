import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Register LifeLink Service Worker for Progressive Web App (PWA) offline static caching & installation
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((registration) => {
        // Track updates to sw
        registration.addEventListener('updatefound', () => {
          const installingWorker = registration.installing;
          if (installingWorker) {
            installingWorker.addEventListener('statechange', () => {
              if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
                console.log('[LifeLink SW] New content available; will be used on next refresh.');
              }
            });
          }
        });
      })
      .catch((error) => {
        console.warn('[LifeLink SW] Service Worker registration failed:', error);
      });
  });
}
