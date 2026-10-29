import React from 'react';
import { Wifi, WifiOff, RefreshCw, AlertTriangle, PhoneCall } from 'lucide-react';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';
import { useSocket } from '../../context/SocketContext';

interface NetworkStatusIndicatorProps {
  isCached?: boolean;
  cacheAge?: string;
  compact?: boolean;
}

export const NetworkStatusIndicator: React.FC<NetworkStatusIndicatorProps> = ({
  isCached = false,
  cacheAge,
  compact = false,
}) => {
  const { isOnline, isServerReachable, isChecking, lastSyncFormatted, checkConnection } = useNetworkStatus();
  const { connected: socketConnected, isReconnecting, reconnect } = useSocket();

  const isHealthy = isOnline && isServerReachable && socketConnected;

  const handleManualRetry = async () => {
    await checkConnection();
    reconnect();
  };

  // Compact header badge
  if (compact) {
    return (
      <div className="flex items-center space-x-2 text-xs">
        {isHealthy ? (
          <div className="flex items-center space-x-1.5 px-2.5 py-1 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-full" title={`Synced: ${lastSyncFormatted}`}>
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="font-medium">Live</span>
            <span className="text-emerald-500/70 hidden sm:inline">({lastSyncFormatted})</span>
          </div>
        ) : (
          <div className="flex items-center space-x-1.5 px-2.5 py-1 bg-amber-500/20 text-amber-300 border border-amber-500/40 rounded-full animate-pulse">
            <WifiOff className="w-3.5 h-3.5" />
            <span className="font-medium">{!isOnline ? 'Offline' : 'Intermittent'}</span>
            <button
              onClick={handleManualRetry}
              disabled={isChecking}
              className="ml-1 p-0.5 hover:bg-amber-500/30 rounded transition-colors"
              title="Retry connection"
            >
              <RefreshCw className={`w-3 h-3 ${isChecking || isReconnecting ? 'animate-spin' : ''}`} />
            </button>
          </div>
        )}

        {isCached && (
          <span className="px-2 py-0.5 bg-yellow-500/20 text-yellow-300 border border-yellow-500/30 rounded text-[10px] font-semibold tracking-wider">
            CACHED {cacheAge ? `(${cacheAge})` : ''}
          </span>
        )}
      </div>
    );
  }

  // Full banner when connection is degraded or offline
  return (
    <div className="w-full mb-4">
      {!isHealthy ? (
        <div className="bg-gradient-to-r from-amber-950/80 via-red-950/80 to-amber-950/80 border-2 border-amber-500/50 rounded-xl p-3 sm:p-4 text-white shadow-xl backdrop-blur-md">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-start space-x-3">
              <div className="p-2 bg-amber-500/20 rounded-lg text-amber-400 shrink-0 mt-0.5 sm:mt-0">
                <WifiOff className="w-5 h-5 animate-pulse" />
              </div>
              <div>
                <div className="flex items-center space-x-2">
                  <h4 className="font-bold text-sm sm:text-base text-amber-200">
                    {!isOnline ? 'Network Connection Lost' : 'Intermittent Mobile Connectivity'}
                  </h4>
                  <span className="px-2 py-0.5 bg-amber-500/30 text-amber-200 text-xs font-semibold rounded">
                    Offline Mode
                  </span>
                </div>
                <p className="text-xs text-amber-300/90 mt-1 max-w-2xl leading-relaxed">
                  Actions are paused until connection restores to prevent duplicate requests. For immediate life-threatening emergencies, do not wait for internet — dial national emergency <strong>112</strong> immediately.
                </p>
                <div className="flex items-center space-x-4 mt-2 text-[11px] text-amber-400/80 font-mono">
                  <span>Last server sync: {lastSyncFormatted}</span>
                  <span>Socket: {socketConnected ? 'Connected' : isReconnecting ? 'Reconnecting...' : 'Disconnected'}</span>
                </div>
              </div>
            </div>

            <div className="flex items-center space-x-2 w-full sm:w-auto shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-amber-500/20">
              <a
                href="tel:112"
                className="flex-1 sm:flex-initial flex items-center justify-center space-x-1.5 px-3.5 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-lg shadow-md transition-colors"
              >
                <PhoneCall className="w-3.5 h-3.5" />
                <span>Call 112</span>
              </a>
              <button
                onClick={handleManualRetry}
                disabled={isChecking || isReconnecting}
                className="flex-1 sm:flex-initial flex items-center justify-center space-x-1.5 px-3 py-2 bg-amber-600/30 hover:bg-amber-600/50 border border-amber-500/40 text-amber-200 text-xs font-semibold rounded-lg transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isChecking || isReconnecting ? 'animate-spin' : ''}`} />
                <span>{isChecking ? 'Checking...' : 'Retry Sync'}</span>
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between px-3 py-1.5 bg-slate-900/60 border border-slate-800 rounded-lg text-xs text-slate-400">
          <div className="flex items-center space-x-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            <span className="text-slate-300 font-medium">Server Connected</span>
            <span className="text-slate-500">•</span>
            <span className="text-slate-400">Last synchronized: {lastSyncFormatted}</span>
          </div>

          <div className="flex items-center space-x-3">
            {isCached && (
              <span className="px-2 py-0.5 bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded text-[10px] font-semibold">
                CACHED DATA {cacheAge ? `(${cacheAge})` : ''}
              </span>
            )}
            <button
              onClick={handleManualRetry}
              disabled={isChecking}
              className="flex items-center space-x-1 hover:text-slate-200 transition-colors"
              title="Refresh connection"
            >
              <RefreshCw className={`w-3 h-3 ${isChecking ? 'animate-spin text-cyan-400' : ''}`} />
              <span className="text-[11px] hidden sm:inline">Sync</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
