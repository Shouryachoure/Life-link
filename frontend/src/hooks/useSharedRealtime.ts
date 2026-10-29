import { useEffect, useRef, useState, useCallback } from 'react';
import { supabase, isSupabaseConfigured } from '../utils/supabaseClient';
import { useSocket } from '../context/SocketContext';
import { useAuth } from '../context/AuthContext';

export interface SharedRealtimeOptions {
  tables?: Array<'emergency_requests' | 'hospital_beds' | 'appointments' | 'directory_facilities' | 'ambulances'>;
  socketEvents?: string[];
  filterPatientId?: string;
  filterHospitalId?: string;
  onTableChange?: (payload: { table: string; eventType: string; newRecord: any; oldRecord: any }) => void;
  onRefresh?: () => void | Promise<void>;
  enabled?: boolean;
}

export interface SharedRealtimeState {
  isRealtimeActive: boolean;
  transportMode: 'DUAL' | 'SOCKET_IO' | 'SUPABASE_REALTIME' | 'OFFLINE_POLL';
  lastEventAt: number | null;
  reconnectCount: number;
}

/**
 * Hook for resilient multi-device realtime synchronization across PC, mobile, and cloud environments.
 * Combines authenticated Socket.IO rooms, Supabase Realtime postgres_changes channels,
 * and visibility/reconnection reconciliation handlers.
 */
export function useSharedRealtime({
  tables = [],
  socketEvents = [],
  filterPatientId,
  filterHospitalId,
  onTableChange,
  onRefresh,
  enabled = true,
}: SharedRealtimeOptions): SharedRealtimeState {
  const { socket, connected: socketConnected } = useSocket();
  const { user } = useAuth();
  const [lastEventAt, setLastEventAt] = useState<number | null>(null);
  const [reconnectCount, setReconnectCount] = useState(0);

  const onTableChangeRef = useRef(onTableChange);
  const onRefreshRef = useRef(onRefresh);

  useEffect(() => {
    onTableChangeRef.current = onTableChange;
    onRefreshRef.current = onRefresh;
  }, [onTableChange, onRefresh]);

  const triggerRefresh = useCallback(() => {
    setLastEventAt(Date.now());
    if (onRefreshRef.current) {
      try {
        onRefreshRef.current();
      } catch (err) {
        console.warn('[useSharedRealtime] Error executing refresh handler:', err);
      }
    }
  }, []);

  // 1. Supabase Realtime Channels
  useEffect(() => {
    if (!enabled || !isSupabaseConfigured() || !supabase || tables.length === 0) {
      return;
    }

    const channelName = `shared_realtime_${tables.join('_')}_${Date.now()}`;
    const channel = supabase.channel(channelName);

    for (const table of tables) {
      let filter: string | undefined = undefined;
      if (filterPatientId && (table === 'emergency_requests' || table === 'appointments')) {
        filter = `patient_id=eq.${filterPatientId}`;
      } else if (filterHospitalId && (table === 'hospital_beds' || table === 'emergency_requests')) {
        filter = `hospital_id=eq.${filterHospitalId}`;
      }

      channel.on(
        'postgres_changes' as any,
        {
          event: '*',
          schema: 'public',
          table,
          filter,
        },
        (payload: any) => {
          setLastEventAt(Date.now());
          if (onTableChangeRef.current) {
            onTableChangeRef.current({
              table,
              eventType: payload.eventType,
              newRecord: payload.new,
              oldRecord: payload.old,
            });
          }
          triggerRefresh();
        }
      );
    }

    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        // Channel actively receiving postgres_changes
      } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
        console.warn(`[useSharedRealtime] Supabase channel ${channelName} state: ${status}`);
      }
    });

    return () => {
      if (supabase) {
        supabase.removeChannel(channel).catch(() => {});
      }
    };
  }, [enabled, tables, filterPatientId, filterHospitalId, triggerRefresh]);

  // 2. Socket.IO Event Subscriptions
  useEffect(() => {
    if (!enabled || !socket || !socketConnected || socketEvents.length === 0) {
      return;
    }

    const handleSocketEvent = (eventData: any) => {
      setLastEventAt(Date.now());
      triggerRefresh();
    };

    for (const ev of socketEvents) {
      socket.on(ev, handleSocketEvent);
    }

    return () => {
      for (const ev of socketEvents) {
        socket.off(ev, handleSocketEvent);
      }
    };
  }, [enabled, socket, socketConnected, socketEvents, triggerRefresh]);

  // 3. Reconnection & Visibility Re-conciliation (Tab focus / mobile wake)
  useEffect(() => {
    if (!enabled) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        triggerRefresh();
      }
    };

    const handleWindowFocus = () => {
      triggerRefresh();
    };

    const handleReconnected = () => {
      setReconnectCount((prev) => prev + 1);
      triggerRefresh();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleWindowFocus);
    window.addEventListener('lifelink:reconnected', handleReconnected);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleWindowFocus);
      window.removeEventListener('lifelink:reconnected', handleReconnected);
    };
  }, [enabled, triggerRefresh]);

  const hasSupabase = isSupabaseConfigured();
  const transportMode: 'DUAL' | 'SOCKET_IO' | 'SUPABASE_REALTIME' | 'OFFLINE_POLL' =
    hasSupabase && socketConnected
      ? 'DUAL'
      : socketConnected
      ? 'SOCKET_IO'
      : hasSupabase
      ? 'SUPABASE_REALTIME'
      : 'OFFLINE_POLL';

  return {
    isRealtimeActive: socketConnected || hasSupabase,
    transportMode,
    lastEventAt,
    reconnectCount,
  };
}
