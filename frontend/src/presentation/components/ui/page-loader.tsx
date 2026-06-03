export const PageLoader = () => (
  <div className="flex min-h-[50vh] items-center justify-center px-6 py-16" role="status" aria-live="polite">
    <div className="relative grid place-items-center">
      <span className="absolute h-14 w-14 rounded-full bg-primary/10 blur-xl" aria-hidden />
      <span className="h-10 w-10 animate-spin rounded-full border-2 border-primary/20 border-t-primary" aria-hidden />
      <span className="sr-only">Caricamento pagina Fleetum...</span>
    </div>
  </div>
);
