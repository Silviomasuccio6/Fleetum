import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppLayout } from "../components/layout/app-layout";
import { PageLoader } from "../components/ui/page-loader";
import { AcceptInvitePage } from "../pages/auth/accept-invite-page";
import { ForgotPasswordPage } from "../pages/auth/forgot-password-page";
import { LoginPage } from "../../features/auth";
import { ResetPasswordPage } from "../pages/auth/reset-password-page";
import { SocialAuthCallbackPage } from "../pages/auth/social-auth-callback-page";
import { SignupPage } from "../pages/auth/signup-page";
import { PrivacyPolicyPage } from "../pages/privacy/privacy-policy-page";
import { CookieConsentBanner } from "../components/privacy/cookie-consent-banner";
import { DemoRequestPage, LegalDocumentPage } from "../pages/legal/legal-pages";
import { LandingPage } from "../pages/landing/landing-page";
import { PublicSeoPage } from "../pages/landing/seo-pages";
import { ProtectedRoute } from "./protected-route";
import { GlobalTextTranslator } from "../components/i18n/global-text-translator";

const DashboardPage = lazy(() => import("../pages/dashboard/dashboard-page").then((m) => ({ default: m.DashboardPage })));
const StoppagesListPage = lazy(() => import("../pages/stoppages/stoppages-list-page").then((m) => ({ default: m.StoppagesListPage })));
const StoppageDetailPage = lazy(() => import("../pages/stoppages/stoppage-detail-page").then((m) => ({ default: m.StoppageDetailPage })));
const StoppageFormPage = lazy(() => import("../pages/stoppages/stoppage-form-page").then((m) => ({ default: m.StoppageFormPage })));
const StoppagesKanbanPage = lazy(() => import("../pages/stoppages/stoppages-kanban-page").then((m) => ({ default: m.StoppagesKanbanPage })));
const StoppagesCalendarPage = lazy(() => import("../pages/stoppages/stoppages-calendar-page").then((m) => ({ default: m.StoppagesCalendarPage })));
const RentalBookingsPage = lazy(() => import("../pages/bookings/rental-bookings-page").then((m) => ({ default: m.RentalBookingsPage })));
const RentalContractsPage = lazy(() => import("../pages/contracts/rental-contracts-page").then((m) => ({ default: m.RentalContractsPage })));
const RentalPricingPage = lazy(() => import("../pages/pricing/rental-pricing-page").then((m) => ({ default: m.RentalPricingPage })));
const SitesPage = lazy(() => import("../pages/sites/sites-page").then((m) => ({ default: m.SitesPage })));
const WorkshopsPage = lazy(() => import("../pages/workshops/workshops-page").then((m) => ({ default: m.WorkshopsPage })));
const VehiclesPage = lazy(() => import("../pages/vehicles/vehicles-page").then((m) => ({ default: m.VehiclesPage })));
const VehicleMaintenancesPage = lazy(() => import("../pages/maintenances/vehicle-maintenances-page").then((m) => ({ default: m.VehicleMaintenancesPage })));
const VehicleDeadlinesPage = lazy(() => import("../pages/deadlines/vehicle-deadlines-page").then((m) => ({ default: m.VehicleDeadlinesPage })));
const CustomersPage = lazy(() => import("../pages/customers/customers-page").then((m) => ({ default: m.CustomersPage })));
const UsersPage = lazy(() => import("../pages/users/users-page").then((m) => ({ default: m.UsersPage })));
const StatsPage = lazy(() => import("../pages/stats/stats-page").then((m) => ({ default: m.StatsPage })));
const ProfileSettingsPage = lazy(() => import("../pages/profile/profile-settings-page").then((m) => ({ default: m.ProfileSettingsPage })));
const CompanyProfilePage = lazy(() => import("../pages/profile/company-profile-page").then((m) => ({ default: m.CompanyProfilePage })));
const PlanUpgradePage = lazy(() => import("../pages/profile/plan-upgrade-page").then((m) => ({ default: m.PlanUpgradePage })));

const withPageLoader = (element: JSX.Element) => <Suspense fallback={<PageLoader />}>{element}</Suspense>;

export const AppRoutes = () => (
  <>
    <GlobalTextTranslator />
    <CookieConsentBanner />
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/accept-invite" element={<AcceptInvitePage />} />
      <Route path="/auth/social-callback" element={<SocialAuthCallbackPage />} />
      <Route path="/privacy" element={<PrivacyPolicyPage />} />
      <Route path="/cookie" element={<LegalDocumentPage type="cookie" />} />
      <Route path="/termini" element={<LegalDocumentPage type="terms" />} />
      <Route path="/dpa" element={<LegalDocumentPage type="dpa" />} />
      <Route path="/demo" element={<DemoRequestPage />} />
      <Route path="/software-autonoleggio" element={<PublicSeoPage slug="software-autonoleggio" />} />
      <Route path="/software-rent-a-car" element={<PublicSeoPage slug="software-rent-a-car" />} />
      <Route path="/gestionale-flotta" element={<PublicSeoPage slug="gestionale-flotta" />} />
      <Route path="/booking-noleggi" element={<PublicSeoPage slug="booking-noleggi" />} />
      <Route path="/contratti-noleggio-digitali" element={<PublicSeoPage slug="contratti-noleggio-digitali" />} />
      <Route path="/report-redditivita-veicolo" element={<PublicSeoPage slug="report-redditivita-veicolo" />} />
      <Route path="/prezzi" element={<PublicSeoPage slug="prezzi" />} />
      <Route path="/" element={<LandingPage />} />
      <Route
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route path="dashboard" element={withPageLoader(<DashboardPage />)} />
        <Route path="booking" element={withPageLoader(<RentalBookingsPage />)} />
        <Route path="booking/contratti" element={withPageLoader(<RentalContractsPage />)} />
        <Route path="booking/listini" element={withPageLoader(<RentalPricingPage />)} />
        <Route path="fermi" element={withPageLoader(<StoppagesListPage />)} />
        <Route path="fermi/kanban" element={withPageLoader(<StoppagesKanbanPage />)} />
        <Route path="fermi/calendario" element={withPageLoader(<StoppagesCalendarPage />)} />
        <Route path="fermi/nuovo" element={withPageLoader(<StoppageFormPage />)} />
        <Route path="fermi/:id" element={withPageLoader(<StoppageDetailPage />)} />
        <Route path="fermi/:id/modifica" element={withPageLoader(<StoppageFormPage />)} />
        <Route path="anagrafiche/sedi" element={withPageLoader(<SitesPage />)} />
        <Route path="anagrafiche/officine" element={withPageLoader(<WorkshopsPage />)} />
        <Route path="anagrafiche/veicoli" element={withPageLoader(<VehiclesPage />)} />
        <Route path="anagrafiche/clienti" element={withPageLoader(<CustomersPage />)} />
        <Route path="anagrafiche/manutenzioni" element={withPageLoader(<VehicleMaintenancesPage />)} />
        <Route path="anagrafiche/scadenziario" element={withPageLoader(<VehicleDeadlinesPage />)} />
        <Route path="utenti" element={withPageLoader(<UsersPage />)} />
        <Route path="profilo" element={withPageLoader(<ProfileSettingsPage />)} />
        <Route path="profilo/azienda" element={withPageLoader(<CompanyProfilePage />)} />
        <Route path="upgrade" element={withPageLoader(<PlanUpgradePage />)} />
        <Route path="statistiche" element={withPageLoader(<StatsPage />)} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  </>
);
