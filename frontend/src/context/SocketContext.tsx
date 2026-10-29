import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuth } from './AuthContext';
import { recordLastSyncTimestamp } from '../utils/offlineStorage';
import { getSocketUrl } from '../config/apiConfig';

interface SocketContextType {
  socket: Socket | null;
  connected: boolean;
  isReconnecting: boolean;
  reconnectAttempt: number;
  lastConnectedAt: number | null;
  reconnect: () => void;
}

const SocketContext = createContext<SocketContextType | undefined>(undefined);

export const SocketProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, token } = useAuth();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [lastConnectedAt, setLastConnectedAt] = useState<number | null>(null);

  const registerUser = useCallback((sock: Socket, currentUser: any) => {
    if (!currentUser) return;
    if (currentUser.role === 'PATIENT') {
      sock.emit('patient:register', currentUser.id);
    } else if (currentUser.role === 'DRIVER') {
      sock.emit('driver:register', currentUser.id);
    } else if (currentUser.role === 'ADMIN_HOSPITAL') {
      sock.emit('hospital:register', currentUser.id);
    } else if (currentUser.role === 'OPERATOR_ADMIN') {
      sock.emit('operator:register', currentUser.id);
    } else if (currentUser.role === 'SUPER_ADMIN') {
      sock.emit('telemetry:register');
      sock.emit('superadmin:register');
    }
  }, []);

  useEffect(() => {
    if (!token || !user) {
      if (socket) {
        socket.disconnect();
        setSocket(null);
        setConnected(false);
        setIsReconnecting(false);
      }
      return;
    }

    const socketUrl = getSocketUrl();

    // Bounded reconnection with exponential backoff (1s initial, 5s max, 15 attempts)
    const newSocket = io(socketUrl, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 15,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 10000,
      auth: {
        token,
      },
    });

    newSocket.on('connect', () => {
      setConnected(true);
      setIsReconnecting(false);
      setReconnectAttempt(0);
      setLastConnectedAt(Date.now());
      recordLastSyncTimestamp('socket:connect');
      registerUser(newSocket, user);
      console.log('Socket.IO safely connected to LifeLink backend');
    });

    newSocket.on('reconnect', (attemptNumber) => {
      setConnected(true);
      setIsReconnecting(false);
      setReconnectAttempt(0);
      setLastConnectedAt(Date.now());
      recordLastSyncTimestamp('socket:reconnect');
      registerUser(newSocket, user);
      console.log(`Socket.IO reconnected after ${attemptNumber} attempts. Broadcasting recovery event.`);
      // Emit global recovery event so active screens refetch authoritative state
      window.dispatchEvent(new CustomEvent('lifelink:reconnected', { detail: { attemptNumber } }));
    });

    newSocket.on('reconnect_attempt', (attempt) => {
      setIsReconnecting(true);
      setReconnectAttempt(attempt);
      console.warn(`Socket.IO reconnect attempt ${attempt}...`);
    });

    newSocket.on('reconnect_error', () => {
      setIsReconnecting(true);
    });

    newSocket.on('reconnect_failed', () => {
      setIsReconnecting(false);
      setConnected(false);
      console.error('Socket.IO reconnection failed after max retries. Manual reconnection required.');
    });

    newSocket.on('disconnect', (reason) => {
      setConnected(false);
      if (reason === 'io server disconnect') {
        // Server actively disconnected; reconnect manually
        newSocket.connect();
      } else {
        setIsReconnecting(true);
      }
      console.log(`Socket disconnected: ${reason}`);
    });

    setSocket(newSocket);

    return () => {
      newSocket.disconnect();
    };
  }, [token, user?.id, user?.role, registerUser]);

  const reconnect = useCallback(() => {
    if (socket) {
      setIsReconnecting(true);
      socket.connect();
    }
  }, [socket]);

  return (
    <SocketContext.Provider
      value={{
        socket,
        connected,
        isReconnecting,
        reconnectAttempt,
        lastConnectedAt,
        reconnect,
      }}
    >
      {children}
    </SocketContext.Provider>
  );
};

export const useSocket = () => {
  const context = useContext(SocketContext);
  if (!context) throw new Error('useSocket must be used within SocketProvider');
  return context;
};
