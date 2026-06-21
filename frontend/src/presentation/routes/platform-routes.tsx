import { Navigate, Route, Routes } from "react-router-dom";
import { PlatformAdminLayout } from "../components/layout/platform-admin-layout";
import { PlatformAdminLoginPage } from "../pages/platform/platform-admin-login-page";
import { PlatformAdminPage } from "../pages/platform/platform-admin-page";
import { PlatformPasswordRecoveryPage } from "../pages/platform/platform-password-recovery-page";
import { PlatformAdminProtectedRoute } from "./platform-admin-protected-route";

export const PlatformRoutes = () => (
  <Routes>
    <Route path="/" element={<Navigate to="/login" replace />} />
    <Route path="/login" element={<PlatformAdminLoginPage />} />
    <Route path="/password-recovery" element={<PlatformPasswordRecoveryPage />} />
    <Route
      path="/console"
      element={
        <PlatformAdminProtectedRoute>
          <PlatformAdminLayout />
        </PlatformAdminProtectedRoute>
      }
    >
      <Route index element={<PlatformAdminPage />} />
    </Route>
    <Route path="*" element={<Navigate to="/login" replace />} />
  </Routes>
);
