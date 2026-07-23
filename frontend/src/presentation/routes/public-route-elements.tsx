import { Route } from "react-router-dom";
import { PrivacyPolicyPage } from "../pages/privacy/privacy-policy-page";
import { DemoRequestPage, LegalDocumentPage } from "../pages/legal/legal-pages";
import { LandingPage } from "../pages/landing/landing-page";
import { PublicSeoPage } from "../pages/landing/seo-pages";

export const publicRouteElements = () => [
  <Route key="privacy" path="/privacy" element={<PrivacyPolicyPage />} />,
  <Route key="cookie" path="/cookie" element={<LegalDocumentPage type="cookie" />} />,
  <Route key="terms" path="/termini" element={<LegalDocumentPage type="terms" />} />,
  <Route key="dpa" path="/dpa" element={<LegalDocumentPage type="dpa" />} />,
  <Route key="demo" path="/demo" element={<DemoRequestPage />} />,
  <Route key="software-rental" path="/software-autonoleggio" element={<PublicSeoPage slug="software-autonoleggio" />} />,
  <Route key="software-rent-a-car" path="/software-rent-a-car" element={<PublicSeoPage slug="software-rent-a-car" />} />,
  <Route key="fleet-management" path="/gestionale-flotta" element={<PublicSeoPage slug="gestionale-flotta" />} />,
  <Route key="rental-booking" path="/booking-noleggi" element={<PublicSeoPage slug="booking-noleggi" />} />,
  <Route key="digital-contracts" path="/contratti-noleggio-digitali" element={<PublicSeoPage slug="contratti-noleggio-digitali" />} />,
  <Route key="vehicle-profitability" path="/report-redditivita-veicolo" element={<PublicSeoPage slug="report-redditivita-veicolo" />} />,
  <Route key="pricing" path="/prezzi" element={<PublicSeoPage slug="prezzi" />} />,
  <Route key="home" path="/" element={<LandingPage />} />
];
