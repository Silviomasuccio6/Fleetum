export type UiRecoveryScope = "app" | "route" | "bootstrap";

type UiRecoveryCopy = {
  eyebrow: string;
  title: string;
  message: string;
  action: string;
};

const COPY: Record<UiRecoveryScope, UiRecoveryCopy> = {
  app: {
    eyebrow: "Fleetum",
    title: "Fleetum non si è avviato correttamente",
    message: "Riprova il caricamento. Le informazioni tecniche dell'errore non vengono mostrate in questa pagina.",
    action: "Riprova"
  },
  route: {
    eyebrow: "Fleetum",
    title: "Questa pagina non è disponibile",
    message: "Il modulo richiesto non è stato caricato. Riprova quando la connessione è stabile.",
    action: "Riprova"
  },
  bootstrap: {
    eyebrow: "Fleetum",
    title: "Fleetum non è disponibile",
    message: "L'applicazione non è stata caricata. Controlla la connessione e riprova.",
    action: "Riprova"
  }
};

export const getUiRecoveryCopy = (scope: UiRecoveryScope): UiRecoveryCopy => COPY[scope];

export const reportUiRecovery = (scope: UiRecoveryScope) => {
  // Deliberately omit the thrown value, component stack and route data: they can
  // contain customer or tenant information. Observability can aggregate this code.
  console.error(`[Fleetum] ui_recovery_fallback:${scope}`);
};

export const renderBootstrapFailure = (
  documentRef: Document = document,
  reload: () => void = () => window.location.reload()
) => {
  const copy = getUiRecoveryCopy("bootstrap");
  let root = documentRef.getElementById("root");
  if (!root) {
    root = documentRef.createElement("div");
    root.id = "root";
    documentRef.body.append(root);
  }

  const main = documentRef.createElement("main");
  main.className = "fleetum-bootstrap-recovery";
  main.setAttribute("role", "alert");
  main.setAttribute("aria-labelledby", "fleetum-bootstrap-recovery-title");

  const card = documentRef.createElement("section");
  card.className = "fleetum-bootstrap-recovery__card";

  const eyebrow = documentRef.createElement("p");
  eyebrow.className = "fleetum-bootstrap-recovery__eyebrow";
  eyebrow.textContent = copy.eyebrow;

  const title = documentRef.createElement("h1");
  title.id = "fleetum-bootstrap-recovery-title";
  title.textContent = copy.title;

  const message = documentRef.createElement("p");
  message.textContent = copy.message;

  const button = documentRef.createElement("button");
  button.type = "button";
  button.textContent = copy.action;
  button.addEventListener("click", reload);

  card.append(eyebrow, title, message, button);
  main.append(card);
  root.replaceChildren(main);
};
