export type BillingLicenseStatus = "PENDING" | "ACTIVE" | "TRIAL" | "PAST_DUE" | "SUSPENDED" | "EXPIRED" | "CANCELED" | null | undefined;

export type BillingStatusNotice = {
  tone: "info" | "warning" | "danger" | "success";
  title: string;
  body: string;
  actionLabel: string;
};

export const getBillingStatusNotice = (status: BillingLicenseStatus): BillingStatusNotice | null => {
  if (status === "PENDING") {
    return {
      tone: "info",
      title: "Abbonamento non ancora attivo",
      body: "Scegli un piano e completa Stripe Checkout con una carta valida. Fleetum si abilita solo dopo conferma webhook.",
      actionLabel: "Scegli un piano"
    };
  }

  if (status === "PAST_DUE") {
    return {
      tone: "warning",
      title: "Pagamento non riuscito",
      body: "Aggiorna la carta o completa il pagamento da Stripe. Il gestionale resta bloccato fino alla conferma del pagamento.",
      actionLabel: "Sostituisci carta"
    };
  }

  if (status === "SUSPENDED") {
    return {
      tone: "danger",
      title: "Abbonamento sospeso",
      body: "Il pagamento non e' stato recuperato entro la finestra prevista. Riattiva o regolarizza l'abbonamento per tornare operativo.",
      actionLabel: "Regolarizza abbonamento"
    };
  }

  if (status === "CANCELED" || status === "EXPIRED") {
    return {
      tone: "danger",
      title: status === "CANCELED" ? "Abbonamento cancellato" : "Licenza scaduta",
      body: "Per usare Fleetum devi riattivare un piano con Stripe Checkout o contattare il supporto.",
      actionLabel: "Riattiva piano"
    };
  }

  return null;
};
