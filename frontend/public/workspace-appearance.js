/* Classic, blocking startup: choose the workspace theme before styles or modules load. */
(function () {
  var workspacePath = /^\/(?:dashboard|booking|rental-bookings|fermi|anagrafiche|utenti|profilo|statistiche)(?:\/|$)/;
  if (!workspacePath.test(window.location.pathname)) return;
  var theme;
  try { theme = window.localStorage.getItem("fermi_theme_mode"); } catch (_) { /* Use the system preference. */ }
  if (theme !== "light" && theme !== "dark") {
    theme = typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.setAttribute("data-fleetum-workspace", "");
})();
