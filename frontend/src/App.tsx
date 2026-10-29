import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { HeartbeatLoader } from './components/ui/HeartbeatLoader';
import { SocketProvider } from './context/SocketContext';
import { NaniChat } from './components/NaniChat';
import Login from './pages/Login';
import Register from './pages/Register';
import Landing from './pages/Landing';
import PatientDashboard from './pages/PatientDashboard';
import DriverDashboard from './pages/DriverDashboard';
import HospitalDashboard from './pages/HospitalDashboard';
import SuperAdminDashboard from './pages/SuperAdminDashboard';
import AdminLogin from './pages/AdminLogin';
import SuperAdminLogin from './pages/SuperAdminLogin';
import HospitalRegister from './pages/HospitalRegister';
import Unauthorized from './pages/Unauthorized';
import NotFound from './pages/NotFound';
import OperatorDashboard from './pages/OperatorDashboard';
import PublicEmergencyMedicalId from './pages/PublicEmergencyMedicalId';
import PublicTripShare from './pages/PublicTripShare';
import ForgotPassword from './pages/ForgotPassword';

// Feature 1: Global Alt+A Shortcut for Hidden Super Admin Gateway
const GlobalKeyboardShortcuts: React.FC = () => {
  const navigate = useNavigate();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        navigate('/super-admin-login');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [navigate]);

  return null;
};

// Protected Route component
const ProtectedRoute: React.FC<{ children: React.ReactNode; allowedRoles: string[] }> = ({
  children,
  allowedRoles,
}) => {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center text-gray-900 dark:text-slate-100 transition-colors">
        <div className="flex flex-col items-center gap-5">
          <HeartbeatLoader size="large" />
          <span className="text-sm font-semibold tracking-wide text-slate-500 dark:text-slate-400">Loading session...</span>
        </div>
      </div>
    );
  }

  if (!user) {
    // Route unauthenticated visitors to their designated portal, preserving destination
    if (allowedRoles.includes('SUPER_ADMIN')) {
      return <Navigate to="/super-admin/login" state={{ from: location }} replace />;
    }
    if (allowedRoles.includes('ADMIN_HOSPITAL')) {
      return <Navigate to="/admin/login" state={{ from: location }} replace />;
    }
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (!allowedRoles.includes(user.role)) {
    // Allow SUPER_ADMIN to inspect hospital admin views
    if (user.role === 'SUPER_ADMIN' && allowedRoles.includes('ADMIN_HOSPITAL')) {
      return <>{children}</>;
    }

    return <Navigate to="/unauthorized" replace />;
  }

  return <>{children}</>;
};

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/register-hospital" element={<HospitalRegister />} />
      <Route path="/admin/login" element={<AdminLogin />} />
      <Route path="/super-admin-login" element={<SuperAdminLogin />} />
      <Route path="/super-admin/login" element={<SuperAdminLogin />} />
      <Route path="/unauthorized" element={<Unauthorized />} />
      <Route path="/medical-id" element={<PublicEmergencyMedicalId />} />
      <Route path="/track-trip" element={<PublicTripShare />} />
      <Route path="/trip-share" element={<PublicTripShare />} />

      <Route
        path="/patient"
        element={
          <ProtectedRoute allowedRoles={['PATIENT']}>
            <PatientDashboard />
          </ProtectedRoute>
        }
      />
      
      <Route
        path="/driver"
        element={
          <ProtectedRoute allowedRoles={['DRIVER']}>
            <DriverDashboard />
          </ProtectedRoute>
        }
      />

      {/* Hospital Admin Routes (accessible via /hospital, /admin, or /admin/dashboard) */}
      <Route
        path="/hospital"
        element={
          <ProtectedRoute allowedRoles={['ADMIN_HOSPITAL', 'SUPER_ADMIN']}>
            <HospitalDashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin"
        element={
          <ProtectedRoute allowedRoles={['ADMIN_HOSPITAL', 'SUPER_ADMIN']}>
            <HospitalDashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/dashboard"
        element={
          <ProtectedRoute allowedRoles={['ADMIN_HOSPITAL', 'SUPER_ADMIN']}>
            <HospitalDashboard />
          </ProtectedRoute>
        }
      />

      {/* Super Admin Routes */}
      <Route
        path="/super-admin"
        element={
          <ProtectedRoute allowedRoles={['SUPER_ADMIN']}>
            <SuperAdminDashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/super-admin/dashboard"
        element={
          <ProtectedRoute allowedRoles={['SUPER_ADMIN']}>
            <SuperAdminDashboard />
          </ProtectedRoute>
        }
      />

      {/* Private Operator Admin Routes */}
      <Route
        path="/operator"
        element={
          <ProtectedRoute allowedRoles={['OPERATOR_ADMIN', 'SUPER_ADMIN']}>
            <OperatorDashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/operator/dashboard"
        element={
          <ProtectedRoute allowedRoles={['OPERATOR_ADMIN', 'SUPER_ADMIN']}>
            <OperatorDashboard />
          </ProtectedRoute>
        }
      />

      {/* 404 Catch-All Route */}
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

// Feature 1: Route-Scoped Placement for Nani AI Chatbot
// Allowed contexts:
// 1. The public landing page ('/')
// 2. The patient panel (e.g. '/patient', '/patient/*', or any patient portal route)
// Explicitly excluded from: Super Admin (/super-admin*), Hospital Admin (/admin*, /hospital*), Driver (/driver*), and Auth pages
const NaniRouteScoped: React.FC = () => {
  const location = useLocation();
  const { user } = useAuth();
  const pathname = location.pathname;

  // Explicitly excluded routes
  if (
    pathname.startsWith('/super-admin') ||
    pathname.startsWith('/admin') ||
    pathname.startsWith('/hospital') ||
    pathname.startsWith('/driver') ||
    pathname === '/login' ||
    pathname === '/register' ||
    pathname === '/register-hospital'
  ) {
    return null;
  }

  // Allowed contexts
  const isLandingPage = pathname === '/';
  const isPatientPanel = pathname.startsWith('/patient') || user?.role === 'PATIENT';

  if (isLandingPage || isPatientPanel) {
    return <NaniChat />;
  }

  return null;
};

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <SocketProvider>
          <BrowserRouter>
            <GlobalKeyboardShortcuts />
            <AppRoutes />
            <NaniRouteScoped />
          </BrowserRouter>
        </SocketProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
