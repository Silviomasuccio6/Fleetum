import { Navigate, Route, Routes } from "react-router-dom";
import { AppLayout } from "../components/layout/app-layout";
import { DashboardPage } from "../pages/dashboard/dashboard-page";
import { AcceptInvitePage } from "../pages/auth/accept-invite-page";
import { ForgotPasswordPage } from "../pages/auth/forgot-password-page";
import { LoginPage } from "../../features/auth";
import { ResetPasswordPage } from "../pages/auth/reset-password-page";
import { SocialAuthCallbackPage } from "../pages/auth/social-auth-callback-page";
import { SignupPage } from "../pages/auth/signup-page";
import { StoppagesListPage } from "../pages/stoppages/stoppages-list-page";
import { StoppageDetailPage } from "../pages/stoppages/stoppage-detail-page";
import { StoppageFormPage } from "../pages/stoppages/stoppage-form-page";
import { StoppagesKanbanPage } from "../pages/stoppages/stoppages-kanban-page";
import { StoppagesCalendarPage } from "../pages/stoppages/stoppages-calendar-page";
import { RentalBookingsPage } from "../pages/bookings/rental-bookings-page";
import { RentalContractsPage } from "../pages/contracts/rental-contracts-page";
import { RentalPricingPage } from "../pages/pricing/rental-pricing-page";
import { SitesPage } from "../pages/sites/sites-page";
import { WorkshopsPage } from "../pages/workshops/workshops-page";
import { VehiclesPage } from "../pages/vehicles/vehicles-page";
import { VehicleMaintenancesPage } from "../pages/maintenances/vehicle-maintenances-page";
import { VehicleDeadlinesPage } from "../pages/deadlines/vehicle-deadlines-page";
import { CustomersPage } from "../pages/customers/customers-page";
import { UsersPage } from "../pages/users/users-page";
import { StatsPage } from "../pages/stats/stats-page";
import { ProfileSettingsPage } from "../pages/profile/profile-settings-page";
import { PlanUpgradePage } from "../pages/profile/plan-upgrade-page";
import { ProtectedRoute } from "./protected-route";

export const AppRoutes = () => (
  <Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route path="/signup" element={<SignupPage />} />
    <Route path="/forgot-password" element={<ForgotPasswordPage />} />
    <Route path="/reset-password" element={<ResetPasswordPage />} />
    <Route path="/accept-invite" element={<AcceptInvitePage />} />
    <Route path="/auth/social-callback" element={<SocialAuthCallbackPage />} />
    <Route
      path="/"
      element={
        <ProtectedRoute>
          <AppLayout />
        </ProtectedRoute>
      }
    >
      <Route index element={<Navigate to="/dashboard" replace />} />
      <Route path="dashboard" element={<DashboardPage />} />
      <Route path="booking" element={<RentalBookingsPage />} />
      <Route path="booking/contratti" element={<RentalContractsPage />} />
      <Route path="booking/listini" element={<RentalPricingPage />} />
      <Route path="fermi" element={<StoppagesListPage />} />
      <Route path="fermi/kanban" element={<StoppagesKanbanPage />} />
      <Route path="fermi/calendario" element={<StoppagesCalendarPage />} />
      <Route path="fermi/nuovo" element={<StoppageFormPage />} />
      <Route path="fermi/:id" element={<StoppageDetailPage />} />
      <Route path="fermi/:id/modifica" element={<StoppageFormPage />} />
      <Route path="anagrafiche/sedi" element={<SitesPage />} />
      <Route path="anagrafiche/officine" element={<WorkshopsPage />} />
      <Route path="anagrafiche/veicoli" element={<VehiclesPage />} />
      <Route path="anagrafiche/clienti" element={<CustomersPage />} />
      <Route path="anagrafiche/manutenzioni" element={<VehicleMaintenancesPage />} />
      <Route path="anagrafiche/scadenziario" element={<VehicleDeadlinesPage />} />
      <Route path="utenti" element={<UsersPage />} />
      <Route path="profilo" element={<ProfileSettingsPage />} />
      <Route path="upgrade" element={<PlanUpgradePage />} />
      <Route path="statistiche" element={<StatsPage />} />
    </Route>

    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>
);
