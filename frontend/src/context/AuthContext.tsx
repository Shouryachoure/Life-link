import React, { createContext, useContext, useState, useEffect } from 'react';
import { clearOfflineCache, recordLastSyncTimestamp } from '../utils/offlineStorage';
import { supabase, isSupabaseConfigured } from '../utils/supabaseClient';
import { getApiBaseUrl } from '../config/apiConfig';

export interface User {
  id: string;
  name: string;
  email: string;
  role: 'PATIENT' | 'DRIVER' | 'ADMIN_HOSPITAL' | 'SUPER_ADMIN' | 'OPERATOR_ADMIN';
  phone?: string;
  isEmailVerified?: boolean;
  isPhoneVerified?: boolean;
  verificationMethod?: string;
  patientProfile?: {
    bloodGroup?: string;
    bloodGroupProvenance?: string;
    allergies?: string;
    allergiesProvenance?: string;
    medicalConditions?: string;
    medicalConditionsProvenance?: string;
    currentMedications?: string;
    medicationsProvenance?: string;
    organDonorStatus?: string;
    preferredHospital?: string;
    consentEmergencySharing?: boolean;
    emergencyAccessToken?: string;
    emergencyContactName?: string;
    emergencyContactPhone?: string;
    medicalNotes?: string;
  } | null;
  driverProfile?: {
    id: string;
    licenseNumber: string;
    licenseExpiry?: string;
    verificationState: string;
    membershipStatus: string;
    isDispatchEligible: boolean;
    hospitalId?: string;
    operatorId?: string;
  };
  managedOperator?: {
    id: string;
    name: string;
    city: string;
    state: string;
    verificationState: string;
  };
  ambulance?: {
    id: string;
    vehicleNumber: string;
    ambulanceType: 'BASIC_LIFE_SUPPORT' | 'ADVANCED_LIFE_SUPPORT' | 'OXYGEN_SUPPORT';
    isAvailable: boolean;
    currentLat: number;
    currentLng: number;
    licenseNumber?: string;
    licenseDoc?: string;
    registrationDoc?: string;
    verificationStatus?: 'PENDING' | 'APPROVED' | 'REJECTED';
    verificationState?: string;
  };
  hospital?: {
    id: string;
    name: string;
    address: string;
    contactNumber: string;
    lat: number;
    lng: number;
    availableBeds: number;
    verificationState?: string;
  };
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (token: string, user: User) => void;
  logout: () => void;
  updateUser: (updatedUser: Partial<User>) => void;
  apiFetch: (endpoint: string, options?: RequestInit) => Promise<any>;
  syncSupabaseSession: (supabaseAccessToken: string, metadata?: any) => Promise<User>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('lifelink_token'));
  const [user, setUser] = useState<User | null>(() => {
    try {
      const saved = localStorage.getItem('lifelink_user');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
  const [loading, setLoading] = useState(true);

  const API_URL = getApiBaseUrl();

  const syncSupabaseSession = async (supabaseAccessToken: string, metadata?: any): Promise<User> => {
    const res = await fetch(`${API_URL}/auth/supabase/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${supabaseAccessToken}`,
      },
      body: JSON.stringify(metadata || {}),
      credentials: 'include',
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.message || 'Failed to synchronize user session with LifeLink.');
    }

    const data = await res.json();
    login(data.token, data.user);
    return data.user;
  };

  // Silent refresh session restore
  const refreshSession = async () => {
    try {
      const response = await fetch(`${API_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });
      if (response.ok) {
        const data = await response.json();
        setToken(data.token);
        setUser(data.user);
        localStorage.setItem('lifelink_token', data.token);
        localStorage.setItem('lifelink_user', JSON.stringify(data.user));
        return data.token;
      } else {
        // If cookie refresh fails and there is no active localStorage token, clear
        if (!localStorage.getItem('lifelink_token')) {
          setToken(null);
          setUser(null);
          localStorage.removeItem('lifelink_user');
        }
      }
    } catch (err) {
      console.error('Silent refresh failed:', err);
    }
  };

  useEffect(() => {
    const initializeAuth = async () => {
      // 1. Check Supabase active session first if configured
      if (isSupabaseConfigured() && supabase) {
        try {
          const { data } = await supabase.auth.getSession();
          if (data?.session?.access_token) {
            await syncSupabaseSession(data.session.access_token);
            setLoading(false);
            return;
          }
        } catch (err) {
          console.warn('[Supabase Session] Startup restore notice:', err);
        }
      }

      // 2. Fall back to cookie silent refresh / local session
      await refreshSession();
      setLoading(false);
    };

    initializeAuth();

    // Listen to Supabase auth state changes
    let authSubscription: any = null;
    if (isSupabaseConfigured() && supabase) {
      const { data } = supabase.auth.onAuthStateChange(async (event, session) => {
        if (event === 'SIGNED_OUT') {
          clearOfflineCache();
          localStorage.removeItem('lifelink_token');
          localStorage.removeItem('lifelink_user');
          setToken(null);
          setUser(null);
        } else if (event === 'TOKEN_REFRESHED' && session?.access_token) {
          setToken(session.access_token);
          localStorage.setItem('lifelink_token', session.access_token);
        }
      });
      authSubscription = data.subscription;
    }

    // Refresh token every 14 minutes silently
    const interval = setInterval(async () => {
      await refreshSession();
    }, 14 * 60 * 1000);

    return () => {
      clearInterval(interval);
      if (authSubscription) {
        authSubscription.unsubscribe();
      }
    };
  }, []);

  const login = (newToken: string, newUser: User) => {
    localStorage.setItem('lifelink_token', newToken);
    localStorage.setItem('lifelink_user', JSON.stringify(newUser));
    setToken(newToken);
    setUser(newUser);
  };

  const logout = async () => {
    try {
      if (isSupabaseConfigured() && supabase) {
        await supabase.auth.signOut().catch(() => {});
      }
      await fetch(`${API_URL}/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      });
    } catch (err) {
      console.error('Logout request failed:', err);
    }
    clearOfflineCache();
    localStorage.removeItem('lifelink_token');
    localStorage.removeItem('lifelink_user');
    setToken(null);
    setUser(null);
  };

  const updateUser = (updatedUser: Partial<User>) => {
    if (!user) return;
    const merged = { ...user, ...updatedUser } as User;
    localStorage.setItem('lifelink_user', JSON.stringify(merged));
    setUser(merged);
  };

  const apiFetch = async (
    endpoint: string,
    options: RequestInit & { timeoutMs?: number; skipRetry?: boolean } = {}
  ) => {
    const { timeoutMs = 12000, skipRetry = false, ...fetchOptions } = options;
    const method = (fetchOptions.method || 'GET').toUpperCase();
    const isIdempotentMethod = method === 'GET' || method === 'HEAD';
    const maxRetries = isIdempotentMethod && !skipRetry ? 2 : 0;

    let attempt = 0;
    let lastError: any = null;

    while (attempt <= maxRetries) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const headers = new Headers(fetchOptions.headers || {});
        const activeToken = token || localStorage.getItem('lifelink_token');
        if (activeToken) {
          headers.set('Authorization', `Bearer ${activeToken}`);
        }
        if (!(fetchOptions.body instanceof FormData) && !headers.has('Content-Type')) {
          headers.set('Content-Type', 'application/json');
        }

        const baseHost = API_URL.replace(/\/api(\/v1)?\/?$/, '');
        let targetUrl: string;
        if (endpoint.startsWith('http://') || endpoint.startsWith('https://')) {
          targetUrl = endpoint;
        } else if (endpoint.startsWith('/api/')) {
          targetUrl = `${baseHost}${endpoint}`;
        } else {
          targetUrl = `${API_URL}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
        }

        const response = await fetch(targetUrl, {
          credentials: 'include',
          ...fetchOptions,
          headers,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (response.status === 401) {
          // Session expired, clear state & cached sensitive data
          clearOfflineCache();
          setToken(null);
          setUser(null);
          localStorage.removeItem('lifelink_token');
          localStorage.removeItem('lifelink_user');
        }

        // Safe retry for transient server errors (502, 503, 504) on idempotent queries
        if (isIdempotentMethod && [502, 503, 504].includes(response.status) && attempt < maxRetries) {
          attempt++;
          await new Promise((res) => setTimeout(res, 500 * Math.pow(2, attempt - 1)));
          continue;
        }

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          const error: any = new Error(errorData.message || 'Request failed');
          error.status = response.status;
          error.code = errorData.code;
          error.data = errorData;
          throw error;
        }

        recordLastSyncTimestamp('apiFetch');
        const parsed = await response.json().catch(() => null);
        if (parsed && typeof parsed === 'object') {
          try {
            Object.defineProperty(parsed, 'ok', { value: true, enumerable: false, writable: true });
            Object.defineProperty(parsed, 'status', { value: response.status, enumerable: false, writable: true });
            Object.defineProperty(parsed, 'json', { value: async () => parsed, enumerable: false, writable: true });
          } catch {
            // Ignore if sealed
          }
        }
        return parsed;

      } catch (err: any) {
        clearTimeout(timeoutId);
        lastError = err;

        if (err.name === 'AbortError') {
          lastError = new Error(`Network request timed out after ${timeoutMs / 1000}s. Please check your connection.`);
          (lastError as any).code = 'NETWORK_TIMEOUT';
        }

        // Only retry safe idempotent queries on network errors
        if (isIdempotentMethod && attempt < maxRetries) {
          attempt++;
          await new Promise((res) => setTimeout(res, 500 * Math.pow(2, attempt - 1)));
          continue;
        }

        break;
      }
    }

    throw lastError;
  };

  return (
    <AuthContext.Provider value={{ user, token, loading, login, logout, updateUser, apiFetch, syncSupabaseSession }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
};
