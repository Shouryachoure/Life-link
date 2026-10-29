import { useState, useEffect, useCallback } from 'react';
import { getLastSyncInfo, formatSyncAge, recordLastSyncTimestamp } from '../utils/offlineStorage';
import { getApiBaseUrl } from '../config/apiConfig';

export type ConnectionState = 'ONLINE' | 'OFFLINE' | 'DEGRADED' | 'CHECKING';

export interface NetworkStatus {
  isOnline: boolean;
  isServerReachable: boolean;
  connectionState: ConnectionState;
  isChecking: boolean;
  lastSyncFormatted: string;
  lastSyncTimestamp: number | null;
  checkConnection: () => Promise<boolean>;
}

export function useNetworkStatus(): NetworkStatus {
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [isServerReachable, setIsServerReachable] = useState<boolean>(true);
  const [isChecking, setIsChecking] = useState<boolean>(false);
  const [lastSyncTimestamp, setLastSyncTimestamp] = useState<number | null>(() => {
    const info = getLastSyncInfo();
    return info ? info.timestamp : null;
  });
  const [lastSyncFormatted, setLastSyncFormatted] = useState<string>(() =>
    formatSyncAge(lastSyncTimestamp ?? undefined)
  );

  const API_URL = getApiBaseUrl();

  // Active server ping with bounded 4s timeout
  const checkConnection = useCallback(async (): Promise<boolean> => {
    if (!navigator.onLine) {
      setIsOnline(false);
      setIsServerReachable(false);
      return false;
    }

    setIsChecking(true);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);

    try {
      const res = await fetch(`${API_URL}/health`, {
        method: 'GET',
        cache: 'no-store',
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const reachable = res.ok;
      setIsServerReachable(reachable);
      setIsOnline(true);
      if (reachable) {
        recordLastSyncTimestamp('healthCheck');
        setLastSyncTimestamp(Date.now());
        setLastSyncFormatted(formatSyncAge(Date.now()));
      }
      setIsChecking(false);
      return reachable;
    } catch {
      clearTimeout(timeout);
      setIsServerReachable(false);
      setIsChecking(false);
      return false;
    }
  }, [API_URL]);

  // Perform active health check on mount
  useEffect(() => {
    checkConnection();
  }, [checkConnection]);

  // Online / offline event listeners
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      checkConnection();
    };

    const handleOffline = () => {
      setIsOnline(false);
      setIsServerReachable(false);
    };

    const handleReconnected = () => {
      setIsOnline(true);
      setIsServerReachable(true);
      setLastSyncTimestamp(Date.now());
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('lifelink:reconnected', handleReconnected);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('lifelink:reconnected', handleReconnected);
    };
  }, [checkConnection]);

  // Periodic relative age recalculation every 15s
  useEffect(() => {
    const interval = setInterval(() => {
      const info = getLastSyncInfo();
      if (info) {
        setLastSyncTimestamp(info.timestamp);
        setLastSyncFormatted(formatSyncAge(info.timestamp));
      } else {
        setLastSyncFormatted('Never synchronized');
      }
    }, 15000);

    return () => clearInterval(interval);
  }, []);

  // Compute composite connection state
  let connectionState: ConnectionState = 'ONLINE';
  if (isChecking) {
    connectionState = 'CHECKING';
  } else if (!isOnline) {
    connectionState = 'OFFLINE';
  } else if (!isServerReachable) {
    connectionState = 'DEGRADED';
  }

  return {
    isOnline,
    isServerReachable,
    connectionState,
    isChecking,
    lastSyncFormatted,
    lastSyncTimestamp,
    checkConnection,
  };
}
