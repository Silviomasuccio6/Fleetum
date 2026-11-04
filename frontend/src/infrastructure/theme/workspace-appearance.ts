// Keep the classic prepaint entry and this route predicate aligned (covered by lifecycle tests).
export const isWorkspacePath = (pathname: string) =>
  /^\/(?:dashboard|booking|rental-bookings|fermi|anagrafiche|utenti|profilo|statistiche)(?:\/|$)/.test(pathname);

export const syncWorkspaceAppearance = (pathname: string) => {
  document.documentElement.toggleAttribute("data-fleetum-workspace", isWorkspacePath(pathname));
};
