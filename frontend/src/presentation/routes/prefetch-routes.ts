export const prefetchDashboard = () => import("../pages/dashboard/dashboard-page");

export const prefetchPrimaryTenantRoutes = () => {
  void Promise.allSettled([
    import("../pages/dashboard/dashboard-page"),
    import("../pages/bookings/rental-bookings-page"),
    import("../pages/vehicles/vehicles-page")
  ]);
};
