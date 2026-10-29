/**
 * LifeLink Universal API & WebSocket Configuration
 *
 * Provides dynamic network-aware URL resolution across multiple deployment topologies:
 * 1. Desktop PC Local Development (http://localhost:5173 -> http://localhost:5001)
 * 2. Mobile Phone on local Wi-Fi (e.g. http://192.168.1.10:5173 -> http://192.168.1.10:5001)
 * 3. Production Cloud Hosting (Frontend on Vercel -> Backend on Render / Supabase)
 * 4. Offline / PWA Service Worker caching
 */

function isLanHostname(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '127.0.0.1') return false;
  return (
    /^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
    /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
    hostname.endsWith('.local')
  );
}

export const getApiBaseUrl = (): string => {
  const envUrl = (import.meta.env.VITE_API_URL || '').trim();

  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname;

    // 1. If explicit non-localhost absolute URL configured (e.g. Render backend in production), prioritize it
    if (envUrl && (envUrl.startsWith('http://') || envUrl.startsWith('https://')) && !envUrl.includes('localhost') && !envUrl.includes('127.0.0.1')) {
      return envUrl;
    }

    // 2. If mobile device connecting over local Wi-Fi LAN
    if (isLanHostname(hostname)) {
      if (envUrl && envUrl.includes('localhost')) {
        return envUrl.replace(/localhost|127\.0\.0\.1/, hostname);
      }
      return '/api';
    }

    // 3. If relative path configured (e.g. '/api' for Vite dev proxy or Vercel rewrites)
    if (envUrl.startsWith('/')) {
      return envUrl;
    }

    // 4. Default for localhost desktop
    if (envUrl) {
      return envUrl;
    }
    return '/api';
  }

  return envUrl || 'http://localhost:5001/api';
};

export const getBackendBaseUrl = (): string => {
  const envBackend = (import.meta.env.VITE_BACKEND_URL || '').trim();

  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname;
    const protocol = window.location.protocol;

    // 1. If explicit production backend URL provided (e.g. Render backend)
    if (envBackend && !envBackend.includes('localhost') && !envBackend.includes('127.0.0.1')) {
      return envBackend;
    }

    // 2. If mobile accessing via local Wi-Fi LAN
    if (isLanHostname(hostname)) {
      if (envBackend && envBackend.includes('localhost')) {
        return envBackend.replace(/localhost|127\.0\.0\.1/, hostname);
      }
      return `${protocol}//${hostname}:5001`;
    }

    // 3. Fallback for localhost desktop
    if (envBackend) {
      return envBackend;
    }
    return `${protocol}//localhost:5001`;
  }

  return envBackend || 'http://localhost:5001';
};

export const getSocketUrl = (): string => {
  const envWs = (import.meta.env.VITE_WS_URL || '').trim();

  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname;
    const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';

    // 1. If explicit production WebSocket URL provided (e.g. Render backend URL)
    if (envWs && !envWs.includes('localhost') && !envWs.includes('127.0.0.1')) {
      return envWs;
    }

    // 2. If mobile accessing via local Wi-Fi LAN
    if (isLanHostname(hostname)) {
      if (envWs && envWs.includes('localhost')) {
        return envWs.replace(/localhost|127\.0\.0\.1/, hostname);
      }
      return `${protocol}//${hostname}:5001`;
    }

    // 3. Fallback for localhost desktop
    if (envWs) {
      return envWs;
    }
    return `${protocol}//localhost:5001`;
  }

  return envWs || 'http://localhost:5001';
};
