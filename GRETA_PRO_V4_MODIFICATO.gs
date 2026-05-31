/* ================================================================
   GRETA S.R.L. — SISTEMA GESTIONE FERMI TECNICI
   Versione 5.2 — Google Apps Script
   ================================================================
   MODIFICHE v5.2 rispetto a v5.1:
   [M9] Sezione separata COPART
        → foglio operativo dedicato + report costi/tempi dedicato
   [M10] Archivio con colonna TIPO FERMO
        → separazione netta STANDARD / COPART
   [M11] Report costi standard filtrato
        → esclude le pratiche COPART
   [M12] Fix buildEmailPreview globale
        → anteprima email Gennaro richiamabile da google.script.run
   [M13] Storico aggiornamenti reale
        → timestamp + autore scritti davvero in cella
   ================================================================ */

/* ----------------------------------------------------------------
   SEZIONE 1 — CONFIGURAZIONE DEFAULT
   ---------------------------------------------------------------- */

const CONFIG_DEFAULT = {
  NOMI_FOGLI           : ["FERMI TECNICI MILANO", "FERMI TECNICI ROMA", "FERMI TECNICI BN", "FERMI TECNICI SGS"],
  FOGLIO_COPART        : "FERMI TECNICI COPART",
  FOGLIO_ARCHIVIO      : "📦 ARCHIVIO STORICO",
  FOGLIO_REPORT        : "📊 REPORT COSTI",
  FOGLIO_REPORT_COPART : "📊 REPORT COSTI COPART",
  FOGLIO_LOG           : "LOG_ERRORI",
  FOGLIO_CONFIG        : "⚙️ CONFIG",
  GIORNI_PAUSA         : 3,
  GIORNI_URGENTE_1     : 7,
  GIORNI_URGENTE_2     : 15,
  EMAIL_CAPO           : "silvio@mtrent.it",
  EMAIL_GENNARO        : "gennaro@mtrent.it",
  NOME_MITTENTE        : "Silvio - GRETA S.R.L."
};

// Cache in memoria per la sessione corrente
let _configCache = null;

function leggiConfig() {
  if (_configCache) return _configCache;

  const cfg = { ...CONFIG_DEFAULT };

  try {
    const ss    = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(cfg.FOGLIO_CONFIG);
    if (!sheet || sheet.getLastRow() < 2) {
      _configCache = cfg;
      return cfg;
    }

    const righe = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
    righe.forEach(([chiave, valore]) => {
      const k = safeStr(chiave).toUpperCase().trim().replace(/\s+/g, "_");
      if (!k) return;

      if (["GIORNI_PAUSA", "GIORNI_URGENTE_1", "GIORNI_URGENTE_2"].includes(k)) {
        const n = parseFloat(valore);
        if (!isNaN(n) && n > 0) cfg[k] = n;
      } else if ([
        "EMAIL_CAPO", "EMAIL_GENNARO", "NOME_MITTENTE",
        "FOGLIO_COPART", "FOGLIO_REPORT_COPART"
      ].includes(k)) {
        const v = safeStr(valore);
        if (v) cfg[k] = v;
      } else if (k === "NOMI_FOGLI") {
        const arr = safeStr(valore).split(";").map(s => s.trim()).filter(Boolean);
        if (arr.length > 0) cfg[k] = arr;
      }
    });
  } catch (e) {}

  _configCache = cfg;
  return cfg;
}

function invalidaConfigCache() {
  _configCache = null;
}

function inizializzaFoglioConfig() {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = CONFIG_DEFAULT;
  let sheet = ss.getSheetByName(cfg.FOGLIO_CONFIG);
  if (sheet) {
    safeAlert("⚠️ Foglio config già presente", "Il foglio \"" + cfg.FOGLIO_CONFIG + "\" esiste già.");
    return;
  }

  sheet = ss.insertSheet(cfg.FOGLIO_CONFIG);

  sheet.getRange(1, 1, 1, 3)
    .setValues([["CHIAVE", "VALORE", "DESCRIZIONE"]])
    .setBackground("#1a237e").setFontColor("#ffffff")
    .setFontWeight("bold").setHorizontalAlignment("center");
  sheet.setRowHeight(1, 28);

  const righe = [
    ["EMAIL_CAPO",           cfg.EMAIL_CAPO,           "Email del responsabile fleet (riceve BCC di tutti i solleciti)"],
    ["EMAIL_GENNARO",        cfg.EMAIL_GENNARO,        "Email destinatario del report fermi"],
    ["NOME_MITTENTE",        cfg.NOME_MITTENTE,        "Nome visualizzato nelle email in uscita"],
    ["GIORNI_PAUSA",         cfg.GIORNI_PAUSA,         "Giorni minimi tra due solleciti email allo stesso destinatario"],
    ["GIORNI_URGENTE_1",     cfg.GIORNI_URGENTE_1,     "Soglia giorni per livello urgente"],
    ["GIORNI_URGENTE_2",     cfg.GIORNI_URGENTE_2,     "Soglia giorni per livello critico"],
    ["NOMI_FOGLI",           cfg.NOMI_FOGLI.join(";"), "Nomi fogli sede separati da punto e virgola (;)"],
    ["FOGLIO_COPART",        cfg.FOGLIO_COPART,        "Foglio operativo separato per i fermi COPART"],
    ["FOGLIO_REPORT_COPART", cfg.FOGLIO_REPORT_COPART, "Report dedicato costi/tempi per i fermi COPART"]
  ];

  sheet.getRange(2, 1, righe.length, 3).setValues(righe).setFontSize(11);
  sheet.setColumnWidth(1, 180);
  sheet.setColumnWidth(2, 220);
  sheet.setColumnWidth(3, 360);
  sheet.setFrozenRows(1);

  safeAlert("✅ Foglio config creato", "Modifica i valori nel foglio \"" + cfg.FOGLIO_CONFIG + "\" per personalizzare la configurazione.");
}

// Intestazioni fisse archivio
const ARCH_COLS = [
  "TIPO FERMO", "SEDE", "MODELLO", "TARGA", "DATA DEL FERMO", "OFFICINA",
  "MOTIVO DEL FERMO", "AGGIORNAMENTI", "RIFERIMENTO",
  "DATA ATTESA PREVISTA", "EMAIL OFFICINA", "EMAIL LEASING",
  "DATA INVIO SOLLECITO", "STATO PRATICA",
  "DATA CHIUSURA", "TOT. GIORNI FERMO", "COSTO GIORNALIERO (€/gg)", "COSTO TOTALE (€)", "FASCIA DURATA"
];
const ARCH_WIDTHS = [110,90,130,90,120,160,180,180,130,130,200,200,130,110,130,100,130,120,115];

const STILE_COLONNE = {
  "MODELLO"                  : { w: 140, align: "left"   },
  "TELAIO"                   : { w: 170, align: "center", mono: true },
  "TARGA"                    : { w: 100, align: "center", mono: true, bold: true },
  "DATA DEL FERMO"           : { w: 120, align: "center", data: true },
  "OFFICINA"                 : { w: 170, align: "left"   },
  "MOTIVO DEL FERMO"         : { w: 190, align: "left",  wrap: true },
  "AGGIORNAMENTI"            : { w: 200, align: "left",  wrap: true },
  "RIFERIMENTO"              : { w: 130, align: "left"   },
  "DATA ATTESA PREVISTA"     : { w: 130, align: "center", data: true },
  "EMAIL OFFICINA"           : { w: 200, align: "left",  piccolo: true },
  "EMAIL LEASING"            : { w: 200, align: "left",  piccolo: true },
  "DATA INVIO SOLLECITO"     : { w: 130, align: "center", data: true },
  "COSTO GIORNALIERO (€/gg)" : { w: 130, align: "center" },
  "STATO PRATICA"            : { w: 120, align: "center", stato: true },
  "SEDE DI RIFERIMENTO"      : { w: 130, align: "center", stato: true }
};

const MAPPA_SEDE_RIFERIMENTO = {
  "BN" : "FERMI TECNICI BN",
  "RM" : "FERMI TECNICI ROMA",
  "MI" : "FERMI TECNICI MILANO"
};

function getNomiFogliOperativi() {
  const cfg = leggiConfig();
  return [...cfg.NOMI_FOGLI, cfg.FOGLIO_COPART].filter(Boolean);
}

function getTipoFermoDaFoglio(nomeFoglio) {
  const cfg = leggiConfig();
  return nomeFoglio === cfg.FOGLIO_COPART ? "COPART" : "STANDARD";
}

function getTemaFoglio(nomeFoglio) {
  const temi = {
    "FERMI TECNICI MILANO" : { bg: "#1a237e", accent: "#3949ab" },
    "FERMI TECNICI ROMA"   : { bg: "#880e4f", accent: "#ad1457" },
    "FERMI TECNICI BN"     : { bg: "#1b5e20", accent: "#2e7d32" },
    "FERMI TECNICI SGS"    : { bg: "#4a148c", accent: "#6a1b9a" },
    "FERMI TECNICI COPART" : { bg: "#5d4037", accent: "#795548" }
  };
  return temi[nomeFoglio] || { bg: "#263238", accent: "#37474f" };
}

function getNomeReportPerTipo(tipo) {
  const cfg = leggiConfig();
  return tipo === "COPART" ? cfg.FOGLIO_REPORT_COPART : cfg.FOGLIO_REPORT;
}

/* ----------------------------------------------------------------
   SEZIONE 2 — MENU
   ---------------------------------------------------------------- */

function onOpen() {
  try {
    SpreadsheetApp.getUi()
      .createMenu("🚀 GESTIONE GRETA PRO")
      .addItem("1. Invia Solleciti Automatici (EMAIL)", "processaTuttiIFogli")
      .addItem("2. Invia Sollecito Manuale (EMAIL)",    "inviaSollecitoManuale")
      .addItem("3. Invia Sollecito WhatsApp",           "inviaWhatsAppManuale")
      .addSeparator()
      .addItem("📊 Dashboard KPI",                      "apriDashboardKPI")
      .addItem("📈 Dashboard Costi (Recharts)",         "apriDashboardCosti")
      .addItem("📈 Andamento Entrate/Uscite",           "apriGraficoAndamento")
      .addItem("🧹 Archivia Pratiche Chiuse (Batch)",   "archiviaPraticheChiuse")
      .addSeparator()
      .addItem("🚗 Crea Sezione COPART",                "creaSezioneCopart")
      .addItem("📊 Ricalcola Report COPART",            "aggiornaReportCostiCopart")
      .addSeparator()
      .addItem("📥 Import Massivo Veicoli (CSV/Excel)", "apriImportMassivo")
      .addItem("📧 Email Report Fermi → Gennaro",       "apriEmailReportGennaro")
      .addSeparator()
      .addItem("🔄 Aggiorna Tutti i Dati",              "aggiornaTuttiIDati")
      .addItem("🧽 Pulisci Storico Aggiornamenti",       "pulisciStoricoAggiornamentiEsistenti")
      .addItem("🎨 Formatta Tutti i Fogli",             "formattaTuttiIFogli")
      .addItem("🎨 Riformatta Archivio",                "riformattaArchivio")
      .addItem("📊 Ricalcola Report Costi",             "ricalcolaReportCosti")
      .addItem("➕ Aggiungi colonna STATO PRATICA",     "aggiungiColonnaStato")
      .addItem("➕ Aggiungi colonna SEDE DI RIFERIMENTO", "aggiungiColonnaSedeRiferimento")
      .addItem("🚚 Applica Spostamenti Sede (manuale)", "applicaSpostamentiSedeRiferimentoManuale")
      .addSeparator()
      .addItem("⚙️ Crea Foglio Configurazione",         "inizializzaFoglioConfig")
      .addItem("⏰ Installa Trigger Giornaliero (08:00)","installaTriggerGiornaliero")
      .addItem("🗑️ Rimuovi Trigger Giornaliero",        "rimuoviTriggerGiornaliero")
      .addItem("🔁 Sostituisci RIFERIMENTO → SEDE DI RIFERIMENTO", "sostituisciRiferimentoConSede")
      .addToUi();
  } catch (e) {}
}

function creaSezioneCopart() {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = leggiConfig();

  let foglio = ss.getSheetByName(cfg.FOGLIO_COPART);
  if (!foglio) {
    foglio = ss.insertSheet(cfg.FOGLIO_COPART);
    foglio.getRange(4, 1, 1, 14).setValues([[
      "MODELLO", "TELAIO", "TARGA", "DATA DEL FERMO", "OFFICINA", "MOTIVO DEL FERMO",
      "AGGIORNAMENTI", "RIFERIMENTO", "DATA ATTESA PREVISTA",
      "EMAIL OFFICINA", "EMAIL LEASING", "DATA INVIO SOLLECITO",
      "COSTO GIORNALIERO (€/gg)", "STATO PRATICA"
    ]]);
  }

  const rigaH = trovaRigaHeader(foglio);
  if (rigaH > 0 && foglio.getLastColumn() > 0) {
    const intestazioni = foglio.getRange(rigaH, 1, 1, foglio.getLastColumn()).getValues()[0]
      .map(h => safeStr(h).toUpperCase());
    const idxTelaio = intestazioni.findIndex(h => h === "TELAIO");
    const idxTarga  = intestazioni.findIndex(h => h === "TARGA");

    if (idxTelaio < 0 && idxTarga >= 0) {
      foglio.insertColumnBefore(idxTarga + 1);
      foglio.getRange(rigaH, idxTarga + 1).setValue("TELAIO");
      invalidaCacheIntestazioni(cfg.FOGLIO_COPART);
    }
  }

  formattaFoglioFermi(foglio, cfg.FOGLIO_COPART);
  invalidaCacheIntestazioni(cfg.FOGLIO_COPART);
  aggiornaReportCostiCopart(ss);

  safeAlert("✅ Sezione COPART pronta", "Creati/aggiornati foglio operativo e report dedicato COPART.");
}

/* ----------------------------------------------------------------
   [M4] CACHE IN-MEMORY DELLE INTESTAZIONI
   ---------------------------------------------------------------- */

const _cacheIntestazioni = {};

function leggiIntestazioniCached(foglio) {
  const nome = foglio.getName();
  if (_cacheIntestazioni[nome]) return _cacheIntestazioni[nome];
  const intestazioni = leggiIntestazioni(foglio);
  _cacheIntestazioni[nome] = intestazioni;
  return intestazioni;
}

function invalidaCacheIntestazioni(nomeFoglio) {
  if (nomeFoglio) {
    delete _cacheIntestazioni[nomeFoglio];
  } else {
    Object.keys(_cacheIntestazioni).forEach(k => delete _cacheIntestazioni[k]);
  }
}

function rigaHaDatiPratica(riga, idxStato0) {
  return riga.some((v, i) => i !== idxStato0 && v !== "" && v !== null && v !== false);
}

/* ----------------------------------------------------------------
   SEZIONE 3 — FORMATTAZIONE FOGLI FERMI TECNICI
   ---------------------------------------------------------------- */

function formattaTuttiIFogli() {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  ss.toast("Formattazione in corso...", "🎨 GRETA PRO", 30);

  const log = [];
  getNomiFogliOperativi().forEach(nome => {
    const f = ss.getSheetByName(nome);
    if (!f) { log.push("❌ " + nome + ": foglio non trovato"); return; }
    try {
      formattaFoglioFermi(f, nome);
      log.push("✅ " + nome);
    } catch(e) {
      log.push("⚠️ " + nome + ": " + e.message);
    }
  });

  ss.toast(log.join("\n"), "✅ Formattazione completata", 10);
}

function aggiornaTuttiIDati() {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  ss.toast("Aggiornamento in corso...", "🔄 GRETA PRO", 30);

  const log = [];

  getNomiFogliOperativi().forEach(nome => {
    const f = ss.getSheetByName(nome);
    if (!f) { log.push("❌ " + nome + ": non trovato"); return; }

    try {
      const rigaH = trovaRigaHeader(f);
      const ultima = f.getLastRow();
      const nCol   = f.getLastColumn();
      if (nCol < 1 || ultima <= rigaH) {
        aggiornaSommarioFoglio(f, nome);
        log.push("✅ " + nome + ": nessuna riga dati");
        return;
      }

      const intestazioni = leggiIntestazioniCached(f);
      const col      = mappaColonne(intestazioni);
      const colStato = trovaColonnaStato(intestazioni);
      const tema     = getTemaFoglio(nome);

      if (colStato > 0) {
        const nRigheDrop = ultima - rigaH;
        if (nRigheDrop > 0) applicaDropdownStato(f.getRange(rigaH + 1, colStato, nRigheDrop, 1));
      }

      const valori = f.getRange(rigaH + 1, 1, ultima - rigaH, nCol).getValues();

      let righeAggiornate = 0;
      valori.forEach((riga, i) => {
        if (!riga.some(v => v !== "" && v !== null && v !== false)) return;

        const nRiga = rigaH + 1 + i;
        formattaRigaDati(f, nRiga, riga, intestazioni, col, tema, i);

        if (colStato > 0) {
          const valStato = riga[colStato - 1] ? riga[colStato - 1].toString() : "";
          if (valStato) coloraCellaStato(f.getRange(nRiga, colStato), valStato.toUpperCase());
        }

        if (col.aggiornamenti >= 0) {
          const testo = riga[col.aggiornamenti].toString().toLowerCase();
          const cAgg  = f.getRange(nRiga, col.aggiornamenti + 1);
          if (testo.includes("attesa") || testo.includes("ricambi")) {
            cAgg.setFontColor("#e65100").setFontWeight("bold");
          } else if (testo.includes("pronto") || testo.includes("completat")) {
            cAgg.setFontColor("#2e7d32").setFontWeight("bold");
          }
        }

        righeAggiornate++;
      });

      aggiornaSommarioFoglio(f, nome);
      log.push("✅ " + nome + ": " + righeAggiornate + " righe aggiornate");
    } catch(err) {
      log.push("⚠️ " + nome + ": " + err.message);
    }
  });

  ss.toast(log.join("\n"), "✅ Aggiornamento completato", 10);
}

function formattaFoglioFermi(foglio, nomeFoglio) {
  const nColonne   = foglio.getLastColumn();
  const ultimaRiga = foglio.getLastRow();
  if (nColonne < 1 || ultimaRiga < 1) return;

  const scansione = foglio.getRange(1, 1, Math.min(ultimaRiga, 8), nColonne).getValues();
  let rigaHeader  = 1;
  for (let r = 0; r < scansione.length; r++) {
    const celle = scansione[r].map(v => v.toString().toUpperCase());
      if (celle.some(v => v.includes("TARGA") || v.includes("MODELLO") || v.includes("TELAIO"))) {
      rigaHeader = r + 1;
      break;
    }
  }

  if (rigaHeader < 4) {
    const rigeDaInserire = 4 - rigaHeader;
    foglio.insertRowsBefore(rigaHeader, rigeDaInserire);
    rigaHeader = 4;
  } else if (rigaHeader > 4) {
    foglio.deleteRows(1, rigaHeader - 4);
    rigaHeader = 4;
  }

  invalidaCacheIntestazioni(nomeFoglio);

  const intestazioni = foglio.getRange(4, 1, 1, nColonne).getValues()[0]
    .map(h => h.toString().toUpperCase().trim());
  const col = mappaColonne(intestazioni);

  const tema = getTemaFoglio(nomeFoglio);
  const sede = nomeFoglio.replace("FERMI TECNICI ", "");

  try { foglio.getRange(1, 1, 1, nColonne).breakApart(); } catch (_) {}
  foglio.getRange(1, 1, 1, nColonne)
    .clearContent().clearFormat()
    .setBackground(tema.bg)
    .setBorder(false, false, false, false, false, false);
  foglio.getRange(1, 1, 1, nColonne).merge()
    .setValue("🚗  FERMI TECNICI — " + sede + "  |  GRETA S.R.L.")
    .setFontColor("#ffffff").setFontSize(13).setFontWeight("bold")
    .setHorizontalAlignment("center").setVerticalAlignment("middle");
  foglio.setRowHeight(1, 40);

  const ultimaRigaPostInsert = foglio.getLastRow();
  let tot = 0, aperte = 0;
  if (ultimaRigaPostInsert >= 5) {
    const righeData = foglio.getRange(5, 1, ultimaRigaPostInsert - 4, nColonne).getValues();
    const colStato  = intestazioni.findIndex(h => h.includes("STATO") && h.includes("PRATICA"));
    righeData.forEach(r => {
      if (!rigaHaDatiPratica(r, colStato)) return;
      tot++;
      const statoP = colStato >= 0 ? r[colStato].toString().toUpperCase() : "";
      const statoA = col.aggiornamenti >= 0 ? r[col.aggiornamenti].toString().toLowerCase() : "";
      const chiuso = statoP.includes("CHIUSO") || statoA.includes("chiuso") || statoA.includes("consegnata") || statoA.includes("ritirata");
      if (!chiuso) aperte++;
    });
  }

  foglio.getRange(2, 1, 1, nColonne).clearContent().clearFormat().setBackground("#f5f5f5");
  foglio.getRange(2, 1).setValue("📋 Pratiche:").setFontWeight("bold").setFontColor(tema.bg).setBackground("#f5f5f5");
  foglio.getRange(2, 2).setValue(tot).setFontWeight("bold").setFontColor(tema.bg).setHorizontalAlignment("center").setBackground("#f5f5f5");
  foglio.getRange(2, 3).setValue("🟢 Aperte:").setFontWeight("bold").setFontColor("#2e7d32").setBackground("#f5f5f5");
  foglio.getRange(2, 4).setValue(aperte).setFontWeight("bold").setFontColor("#2e7d32").setHorizontalAlignment("center").setBackground("#f5f5f5");
  foglio.getRange(2, 5).setValue("🔴 Chiuse:").setFontWeight("bold").setFontColor("#c62828").setBackground("#f5f5f5");
  foglio.getRange(2, 6).setValue(tot - aperte).setFontWeight("bold").setFontColor("#c62828").setHorizontalAlignment("center").setBackground("#f5f5f5");
  foglio.getRange(2, nColonne)
    .setValue("Aggiornato: " + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm"))
    .setFontSize(9).setFontColor("#9e9e9e").setHorizontalAlignment("right").setBackground("#f5f5f5");
  foglio.getRange(2, 1, 1, nColonne)
    .setBorder(false, false, true, false, false, false, "#ddd", SpreadsheetApp.BorderStyle.SOLID);
  foglio.setRowHeight(2, 26);

  foglio.getRange(3, 1, 1, nColonne).clearContent().clearFormat().setBackground(tema.accent);
  foglio.setRowHeight(3, 4);

  foglio.getRange(4, 1, 1, nColonne)
    .setBackground(tema.bg).setFontColor("#ffffff").setFontWeight("bold")
    .setFontSize(10).setHorizontalAlignment("center").setVerticalAlignment("middle")
    .setBorder(true, true, true, true, true, true, tema.accent, SpreadsheetApp.BorderStyle.SOLID);
  foglio.setRowHeight(4, 30);

  intestazioni.forEach((h, i) => {
    const stile = STILE_COLONNE[h];
    foglio.setColumnWidth(i + 1, stile ? stile.w : 130);
  });

  const ultimaFinale = foglio.getLastRow();
  if (ultimaFinale >= 5) {
    const righeValori = foglio.getRange(5, 1, ultimaFinale - 4, nColonne).getValues();
    const idxStato0 = trovaColonnaStato(intestazioni) - 1;
    for (let i = 0; i < righeValori.length; i++) {
      const nRiga = 5 + i;
      if (!rigaHaDatiPratica(righeValori[i], idxStato0)) continue;
      formattaRigaDati(foglio, nRiga, righeValori[i], intestazioni, col, tema, i);
    }
  }

  foglio.setFrozenRows(4);
  foglio.setFrozenColumns(0);

  const colStato1 = trovaColonnaStato(intestazioni);
  if (colStato1 > 0) {
    if (ultimaFinale >= 5) {
      const righeStato = foglio.getRange(5, 1, ultimaFinale - 4, nColonne).getValues();
      const idxStato0 = colStato1 - 1;
      for (let i = 0; i < righeStato.length; i++) {
        const r = 5 + i;
        const cellaStato = foglio.getRange(r, colStato1);
        if (!rigaHaDatiPratica(righeStato[i], idxStato0)) {
          cellaStato.clearContent().clearDataValidations().setBackground(null).setFontColor(null).setFontWeight("normal");
          continue;
        }
        applicaDropdownStato(cellaStato);
        const v = cellaStato.getValue().toString();
        if (v) coloraCellaStato(cellaStato, v.toUpperCase());
      }
    }
  }

  if (ultimaFinale >= 5) {
    foglio.getRange(4, 1, ultimaFinale - 3, nColonne)
      .setBorder(true, true, true, true, null, null, "#bdbdbd", SpreadsheetApp.BorderStyle.SOLID);
  }
}

/* ----------------------------------------------------------------
   [M3] FORMATTAZIONE RIGA CON BATCH API CALLS
   ---------------------------------------------------------------- */

function formattaRigaDati(foglio, nRiga, riga, intestazioni, col, tema, indice) {
  const nCol    = intestazioni.length;
  const alterno = indice % 2 === 0;
  const bgBase  = alterno ? "#fafafa" : "#ffffff";

  const sfondi       = new Array(nCol).fill(bgBase);
  const coloriTesto  = new Array(nCol).fill("#2d3748");
  const pesi         = new Array(nCol).fill("normal");
  const allineamenti = new Array(nCol).fill("left");
  const famiglie     = new Array(nCol).fill(null);
  const dimensioni   = new Array(nCol).fill(10);

  let urgenzaSfondo = bgBase;
  if (col.dataFermo >= 0 && riga[col.dataFermo]) {
    const giorni  = calcolaGiorni(riga[col.dataFermo]);
    const livello = urgenzaLivello(giorni);
    if (livello >= 3) {
      urgenzaSfondo = alterno ? "#fff5f5" : "#fff8f8";
      sfondi.fill(urgenzaSfondo);
      sfondi[0]      = "#f85149";
      coloriTesto[0] = "#ffffff";
      pesi[0]        = "bold";
    } else if (livello === 2) {
      urgenzaSfondo = alterno ? "#fff8f0" : "#fffaf5";
      sfondi.fill(urgenzaSfondo);
      sfondi[0]      = "#ffa657";
      coloriTesto[0] = "#ffffff";
      pesi[0]        = "bold";
    }
  }

  intestazioni.forEach((h, i) => {
    const stile = STILE_COLONNE[h];
    if (!stile) return;
    if (stile.align)   allineamenti[i] = stile.align;
    if (stile.mono)    { famiglie[i] = "Courier New"; dimensioni[i] = 11; }
    if (stile.bold)    { pesi[i] = "bold"; coloriTesto[i] = tema.bg; }
    if (stile.piccolo) { dimensioni[i] = 9; coloriTesto[i] = "#90a4ae"; }
    if (stile.data)    { coloriTesto[i] = "#546e7a"; allineamenti[i] = "center"; }
  });

  if (col.aggiornamenti >= 0) {
    const testoAgg = riga[col.aggiornamenti].toString().toLowerCase();
    if (testoAgg.includes("attesa") || testoAgg.includes("ricambi")) {
      coloriTesto[col.aggiornamenti] = "#e65100";
      pesi[col.aggiornamenti]        = "bold";
    } else if (testoAgg.includes("pronto") || testoAgg.includes("completat")) {
      coloriTesto[col.aggiornamenti] = "#2e7d32";
      pesi[col.aggiornamenti]        = "bold";
    }
  }

  const rg = foglio.getRange(nRiga, 1, 1, nCol);
  rg.setBackgrounds([sfondi]);
  rg.setFontColors([coloriTesto]);
  rg.setFontWeights([pesi]);
  rg.setHorizontalAlignments([allineamenti]);
  rg.setFontSizes([dimensioni]);
  rg.setWrap(false);
  rg.setFontSize(10).setVerticalAlignment("middle");
  rg.setBorder(false, false, true, false, false, false, "#e0e0e0", SpreadsheetApp.BorderStyle.SOLID);
  foglio.setRowHeight(nRiga, 26);

  intestazioni.forEach((h, i) => {
    if (STILE_COLONNE[h] && STILE_COLONNE[h].mono) {
      foglio.getRange(nRiga, i + 1).setFontFamily("Courier New").setFontSize(11);
    }
    if (STILE_COLONNE[h] && STILE_COLONNE[h].wrap) {
      foglio.getRange(nRiga, i + 1).setWrap(true);
    }
  });

  const colStato = trovaColonnaStato(intestazioni);
  if (colStato > 0) {
    const valStato = riga[colStato - 1] ? riga[colStato - 1].toString() : "";
    coloraCellaStato(foglio.getRange(nRiga, colStato), valStato.toUpperCase());
  }
}

/* ----------------------------------------------------------------
   SEZIONE 4 — TRIGGER onEdit
   ---------------------------------------------------------------- */

function onEdit(e) {
  if (!e || !e.range) return;

  const foglio   = e.range.getSheet();
  const nome     = foglio.getName();
  const rigaEdit = e.range.getRow();
  const colEdit  = e.range.getColumn();
  const nuovoVal = (e.value || "").toString().toUpperCase().trim();
  const cfg      = leggiConfig();

  if (getNomiFogliOperativi().includes(nome)) {
    const rigaH = trovaRigaHeader(foglio);
    if (rigaEdit <= rigaH) return;

    let intestazioni = leggiIntestazioniCached(foglio);
    let col          = mappaColonne(intestazioni);
    const headerEdit = safeStr(intestazioni[colEdit - 1]).toUpperCase();
    if (col.sedeRiferimento < 0 && headerEdit.includes("SEDE") && headerEdit.includes("RIFERIMENTO")) {
      invalidaCacheIntestazioni(nome);
      intestazioni = leggiIntestazioni(foglio);
      col = mappaColonne(intestazioni);
      if (col.sedeRiferimento < 0) col.sedeRiferimento = colEdit - 1;
    }
    const colStato = trovaColonnaStato(intestazioni);

    if (nome === cfg.FOGLIO_COPART && col.targa >= 0 && colEdit === col.targa + 1) {
      const nuovaTarga = safeStr(e.value).toUpperCase();
      if (nuovaTarga) {
        Utilities.sleep(200);
        spostaCopartInBNConTarga(foglio, rigaEdit, intestazioni, col);
      }
      return;
    }

    const editSuSedeRif = (col.sedeRiferimento >= 0 && colEdit === col.sedeRiferimento + 1)
      || (headerEdit.includes("SEDE") && headerEdit.includes("RIFERIMENTO"));
    if (editSuSedeRif) {
      const sedeSel = nuovoVal.toUpperCase().trim();
      if (["BN", "RM", "MI"].includes(sedeSel)) {
        Utilities.sleep(200);
        spostaRigaPerSede(foglio, rigaEdit, sedeSel, nome, intestazioni, col);
      } else if (sedeSel !== "") {
        SpreadsheetApp.getActiveSpreadsheet().toast("Valore sede non valido: " + sedeSel + ". Usa BN, RM o MI.", "⚠️ Sede", 5);
      }
      return;
    }

    if (colStato > 0 && colEdit === colStato) {
      coloraCellaStato(e.range, nuovoVal);
      aggiornaColoreRiga(foglio, rigaEdit, col, intestazioni);
      aggiornaSommarioFoglio(foglio, nome);
      if (nuovoVal.includes("CHIUSO")) {
        Utilities.sleep(300);
        spostaInArchivio(foglio, rigaEdit, col, colStato - 1, nome, intestazioni);
      }
      return;
    }

    if (col.aggiornamenti >= 0 && colEdit === col.aggiornamenti + 1) {
      const pulito = normalizzaAggiornamentoSingolo(e.value || "");
      if (safeStr(e.range.getValue()) !== pulito) e.range.setValue(pulito);
      const testo   = pulito.toLowerCase();

      const parolaChiave = ["chiuso", "consegnata", "ritirata"].some(k =>
        testo === k || testo.startsWith(k + " ") || testo.endsWith(" " + k));
      if (parolaChiave) {
        if (colStato > 0) {
          const c = foglio.getRange(rigaEdit, colStato);
          c.setValue("🔴 CHIUSO");
          coloraCellaStato(c, "CHIUSO");
        }
        Utilities.sleep(300);
        spostaInArchivio(foglio, rigaEdit, col, colStato - 1, nome, intestazioni);
        return;
      }
      if (testo.includes("attesa") || testo.includes("ricambi")) {
        e.range.setFontColor("#e65100").setFontWeight("bold");
      } else if (testo.includes("pronto") || testo.includes("completat")) {
        e.range.setFontColor("#2e7d32").setFontWeight("bold");
      } else {
        e.range.setFontColor("#2d3748").setFontWeight("normal");
      }
      aggiornaSommarioFoglio(foglio, nome);
      return;
    }

    if (col.costoGiornaliero >= 0 && colEdit === col.costoGiornaliero + 1) {
      const raw    = (e.value || "").toString().trim();
      const pulito = raw.replace(/€/g, "").replace(/\s/g, "").replace(/\./g, "").replace(/,/g, ".");
      const numero = parseFloat(pulito);
      if (!isNaN(numero) && numero >= 0) {
        e.range.setValue(numero);
        e.range.setNumberFormat("€#,##0.00");
        e.range.setFontColor("#2d3748").setFontWeight("normal");
      } else if (raw !== "") {
        e.range.setValue("").setBackground("#ffebee");
        SpreadsheetApp.getActiveSpreadsheet()
          .toast("Valore \"" + raw + "\" non valido. Inserisci solo il numero (es. 80 oppure 80,50).", "⚠️ Costo non valido", 6);
      }
      aggiornaColoreRiga(foglio, rigaEdit, col, intestazioni);
      aggiornaSommarioFoglio(foglio, nome);
      return;
    }

    aggiornaColoreRiga(foglio, rigaEdit, col, intestazioni);
    aggiornaSommarioFoglio(foglio, nome);
    return;
  }

  if (nome === leggiConfig().FOGLIO_ARCHIVIO) {
    riparaRigheArchivioDisallineate(foglio);
    if (rigaEdit < 5) return;
    const intestazioni = foglio.getRange(4, 1, 1, foglio.getLastColumn()).getValues()[0]
      .map(h => h.toString().toUpperCase().trim());

    const colStato  = intestazioni.findIndex(h => h.includes("STATO") && h.includes("PRATICA"));
    const colCostoG = intestazioni.findIndex(h => h.includes("COSTO") && h.includes("GIORNALIERO"));
    const colGiorni = intestazioni.findIndex(h => h.includes("TOT") && h.includes("GIORNI"));
    const colCostoT = intestazioni.findIndex(h => h.includes("COSTO") && h.includes("TOTALE"));

    if (colStato >= 0 && colEdit === colStato + 1) {
      coloraCellaStato(e.range, nuovoVal);
      if (nuovoVal.includes("APERTO")) {
        Utilities.sleep(300);
        riapriDaArchivio(foglio, rigaEdit, intestazioni);
      }
      return;
    }

    if (colCostoG >= 0 && colEdit === colCostoG + 1) {
      const costoG = parseFloat(e.value) || 0;
      const giorni = colGiorni >= 0 ? (parseFloat(foglio.getRange(rigaEdit, colGiorni + 1).getValue()) || 0) : 0;
      const totale = (costoG > 0 && giorni > 0) ? costoG * giorni : "";
      if (colCostoT >= 0) {
        foglio.getRange(rigaEdit, colCostoT + 1).setValue(totale);
        SpreadsheetApp.flush();
      }
      aggiornaReportCosti(SpreadsheetApp.getActiveSpreadsheet());
      aggiornaReportCostiCopart(SpreadsheetApp.getActiveSpreadsheet());
      return;
    }

    if (colCostoT >= 0 && colEdit === colCostoT + 1) {
      SpreadsheetApp.flush();
      aggiornaReportCosti(SpreadsheetApp.getActiveSpreadsheet());
      aggiornaReportCostiCopart(SpreadsheetApp.getActiveSpreadsheet());
      return;
    }
  }
}

function aggiornaColoreRiga(foglio, nRiga, col, intestazioni) {
  const riga = foglio.getRange(nRiga, 1, 1, foglio.getLastColumn()).getValues()[0];
  const nome = foglio.getName();
  const tema = getTemaFoglio(nome);
  formattaRigaDati(foglio, nRiga, riga, intestazioni, col, tema, nRiga - 5);
}

/* ----------------------------------------------------------------
   [M7] STORICO MODIFICHE CON TIMESTAMP E AUTORE
   ---------------------------------------------------------------- */

function appendStorico(foglio, rigaIndex, col, nuovoTesto, vecchioTesto) {
  // Storico disattivato: si mantiene solo il testo corrente digitato in cella.
  return;
}

/* ----------------------------------------------------------------
   SEZIONE 5 — ARCHIVIAZIONE
   ---------------------------------------------------------------- */

function spostaInArchivio(foglio, rigaIndex, col, colStato0, nomeFoglio, intestazioni) {
  const ss   = SpreadsheetApp.getActiveSpreadsheet();
  const cfg  = leggiConfig();
  const nCol = foglio.getLastColumn();
  const dati = foglio.getRange(rigaIndex, 1, 1, nCol).getValues()[0];

  const tipoFermo    = getTipoFermoDaFoglio(nomeFoglio);
  const idv          = getIdentificativoVeicolo(dati, col);
  const dataFermoRaw = col.dataFermo >= 0 ? dati[col.dataFermo] : null;
  const giorniTot    = dataFermoRaw ? calcolaGiorni(dataFermoRaw) : null;
  const fascia       = calcolaFascia(giorniTot);
  const statoCell    = "🔴 CHIUSO";
  const sede         = tipoFermo === "COPART" ? "COPART" : nomeFoglio.replace("FERMI TECNICI ", "");
  const costoGiorn   = col.costoGiornaliero >= 0 ? (parseFloat(dati[col.costoGiornaliero]) || 0) : 0;
  const costoTotale  = (giorniTot !== null && costoGiorn > 0) ? giorniTot * costoGiorn : "";
  const rifOrig      = col.riferimento >= 0 ? safeStr(dati[col.riferimento]) : "";
  const telaio       = col.telaio >= 0 ? safeStr(dati[col.telaio]) : "";
  const riferimentoArch = [rifOrig, (telaio && !rifOrig.includes(telaio)) ? "Telaio: " + telaio : ""]
    .filter(Boolean)
    .join(" | ");

  const rigaArch = [
    tipoFermo,
    sede,
    col.modello       >= 0 ? safeStr(dati[col.modello])       : "",
    idv.valore || "",
    fmtData(dataFermoRaw),
    col.officina      >= 0 ? safeStr(dati[col.officina])      : "",
    col.motivo        >= 0 ? safeStr(dati[col.motivo])        : "",
    col.aggiornamenti >= 0 ? safeStr(dati[col.aggiornamenti]) : "",
    riferimentoArch,
    fmtData(col.dataAttesa >= 0 ? dati[col.dataAttesa] : null),
    col.emailOff  >= 0 ? safeStr(dati[col.emailOff])  : "",
    col.emailLeas >= 0 ? safeStr(dati[col.emailLeas]) : "",
    fmtData(col.dataInvio >= 0 ? dati[col.dataInvio] : null),
    statoCell,
    Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm"),
    giorniTot !== null ? giorniTot : "",
    costoGiorn > 0 ? costoGiorn : "",
    costoTotale,
    fascia
  ];

  let arch = ss.getSheetByName(cfg.FOGLIO_ARCHIVIO);
  if (!arch) { arch = ss.insertSheet(cfg.FOGLIO_ARCHIVIO); inizializzaArchivio(arch); }
  const metaArch = getMetaArchivio(arch);

  const rigaArchCompat = metaArch.schemaNuovo ? rigaArch : [
    sede,
    col.modello       >= 0 ? safeStr(dati[col.modello])       : "",
    idv.valore || "",
    fmtData(dataFermoRaw),
    col.officina      >= 0 ? safeStr(dati[col.officina])      : "",
    col.motivo        >= 0 ? safeStr(dati[col.motivo])        : "",
    col.aggiornamenti >= 0 ? safeStr(dati[col.aggiornamenti]) : "",
    riferimentoArch,
    fmtData(col.dataAttesa >= 0 ? dati[col.dataAttesa] : null),
    col.emailOff  >= 0 ? safeStr(dati[col.emailOff])  : "",
    col.emailLeas >= 0 ? safeStr(dati[col.emailLeas]) : "",
    fmtData(col.dataInvio >= 0 ? dati[col.dataInvio] : null),
    statoCell,
    Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm"),
    giorniTot !== null ? giorniTot : "",
    costoGiorn > 0 ? costoGiorn : "",
    costoTotale,
    fascia
  ];

  const nRigaArch = arch.getLastRow() + 1;
  arch.getRange(nRigaArch, 1, 1, rigaArchCompat.length).setValues([rigaArchCompat]);
  formattaRigaArchivio(arch, nRigaArch, giorniTot, fascia, nRigaArch % 2 === 0);
  const colStatoArch = metaArch.col.stato >= 0 ? metaArch.col.stato + 1 : ARCH_COLS.indexOf("STATO PRATICA") + 1;
  applicaDropdownStato(arch.getRange(nRigaArch, colStatoArch));

  SpreadsheetApp.flush();

  const colTarga        = metaArch.col.targa >= 0 ? metaArch.col.targa + 1 : ARCH_COLS.indexOf("TARGA") + 1;
  const targaScritta    = arch.getRange(nRigaArch, colTarga).getValue().toString().toUpperCase().trim();
  const targaOriginale  = safeStr(idv.valore).toUpperCase().trim();

  if (targaOriginale && targaScritta !== targaOriginale) {
    scriviLog([[
      new Date(),
      targaOriginale,
      "ERRORE archiviazione: targa scritta [" + targaScritta + "] ≠ originale [" + targaOriginale + "]. Riga NON eliminata."
    ]]);
    ss.toast(
      "⚠️ Errore verifica archivio per " + targaOriginale + ". Riga NON eliminata. Controlla LOG_ERRORI.",
      "❌ ERRORE CRITICO", 15
    );
    return;
  }

  aggiornaRiepilogoArchivio(arch);
  foglio.deleteRow(rigaIndex);
  aggiornaSommarioFoglio(foglio, nomeFoglio);
  aggiornaReportCosti(ss);
  aggiornaReportCostiCopart(ss);

  const targa    = targaOriginale || "—";
  const costoMsg = costoTotale ? " | Costo stimato: €" + costoTotale.toLocaleString("it-IT") : "";
  ss.toast(
    "Pratica " + targa + " archiviata. Fermo: " + (giorniTot !== null ? giorniTot + " giorni" : "N/D") + costoMsg,
    "📦 Chiusa", 8
  );
}

function spostaCopartInBNConTarga(foglioCopart, rigaIndex, intestazioniCopart, colCopart) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const nomeTarget = "FERMI TECNICI BN";

  let target = ss.getSheetByName(nomeTarget);
  if (!target) {
    target = ss.insertSheet(nomeTarget);
    formattaFoglioFermi(target, nomeTarget);
    invalidaCacheIntestazioni(nomeTarget);
  }

  const dati = foglioCopart.getRange(rigaIndex, 1, 1, foglioCopart.getLastColumn()).getValues()[0];
  const idv  = getIdentificativoVeicolo(dati, colCopart);
  if (!idv.targa) return;

  const intTarget  = leggiIntestazioniCached(target);
  const colTarget  = mappaColonne(intTarget);
  const colStatoT  = trovaColonnaStato(intTarget);
  const nColTarget = target.getLastColumn();
  const nuovaRiga  = new Array(nColTarget).fill("");

  const scrivi = (colT0, val) => {
    if (colT0 >= 0 && colT0 < nColTarget && val !== undefined) nuovaRiga[colT0] = val;
  };

  const rifOrig = colCopart.riferimento >= 0 ? safeStr(dati[colCopart.riferimento]) : "";
  const telaio  = colCopart.telaio >= 0 ? safeStr(dati[colCopart.telaio]) : "";
  const rifBN   = [rifOrig, telaio ? "Telaio: " + telaio : ""].filter(Boolean).join(" | ");

  scrivi(colTarget.modello,          colCopart.modello          >= 0 ? dati[colCopart.modello]          : "");
  scrivi(colTarget.targa,            idv.targa);
  scrivi(colTarget.dataFermo,        colCopart.dataFermo        >= 0 ? dati[colCopart.dataFermo]        : "");
  scrivi(colTarget.officina,         colCopart.officina         >= 0 ? dati[colCopart.officina]         : "");
  scrivi(colTarget.motivo,           colCopart.motivo           >= 0 ? dati[colCopart.motivo]           : "");
  scrivi(colTarget.aggiornamenti,    colCopart.aggiornamenti    >= 0 ? dati[colCopart.aggiornamenti]    : "");
  scrivi(colTarget.riferimento,      rifBN);
  scrivi(colTarget.dataAttesa,       colCopart.dataAttesa       >= 0 ? dati[colCopart.dataAttesa]       : "");
  scrivi(colTarget.emailOff,         colCopart.emailOff         >= 0 ? dati[colCopart.emailOff]         : "");
  scrivi(colTarget.emailLeas,        colCopart.emailLeas        >= 0 ? dati[colCopart.emailLeas]        : "");
  scrivi(colTarget.dataInvio,        colCopart.dataInvio        >= 0 ? dati[colCopart.dataInvio]        : "");
  scrivi(colTarget.costoGiornaliero, colCopart.costoGiornaliero >= 0 ? dati[colCopart.costoGiornaliero] : "");

  if (colStatoT > 0) nuovaRiga[colStatoT - 1] = "🟢 APERTO";

  const nRigaTarget = target.getLastRow() + 1;
  target.getRange(nRigaTarget, 1, 1, nColTarget).setValues([nuovaRiga]);

  const tema = getTemaFoglio(nomeTarget);
  formattaRigaDati(target, nRigaTarget, nuovaRiga, intTarget, colTarget, tema, nRigaTarget - 5);

  if (colStatoT > 0) {
    const c = target.getRange(nRigaTarget, colStatoT);
    applicaDropdownStato(c);
    coloraCellaStato(c, "APERTO");
  }

  SpreadsheetApp.flush();

  const targaScritta = colTarget.targa >= 0
    ? safeStr(target.getRange(nRigaTarget, colTarget.targa + 1).getValue()).toUpperCase()
    : "";

  if (targaScritta !== idv.targa) {
    scriviLog([[new Date(), idv.targa, "ERRORE passaggio COPART→BN: targa scritta non corretta. Riga COPART non eliminata."]]);
    SpreadsheetApp.getActiveSpreadsheet().toast("⚠️ Errore nel passaggio automatico COPART → BN. Controlla LOG_ERRORI.", "❌", 10);
    return;
  }

  foglioCopart.deleteRow(rigaIndex);
  aggiornaSommarioFoglio(foglioCopart, foglioCopart.getName());
  aggiornaSommarioFoglio(target, nomeTarget);

  SpreadsheetApp.getActiveSpreadsheet().toast("✅ " + idv.targa + " spostata automaticamente in " + nomeTarget, "COPART → BN", 6);
}

function spostaRigaPerSede(foglioOrigine, rigaIndex, sedeSel, nomeOrigine, intestazioniOrig, colOrig) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  try {
    const sede = safeStr(sedeSel).toUpperCase();
    const nomeTarget = MAPPA_SEDE_RIFERIMENTO[sede];
    if (!nomeTarget) {
      ss.toast("⚠️ Sede non valida: " + sede, "Spostamento sede", 6);
      return;
    }

    if (nomeTarget === nomeOrigine) {
      ss.toast("ℹ️ Il veicolo è già nel foglio " + nomeTarget, "Sede invariata", 4);
      return;
    }

    let target = ss.getSheetByName(nomeTarget);
    if (!target) {
      target = ss.insertSheet(nomeTarget);
      target.getRange(4, 1, 1, 15).setValues([[
        "MODELLO", "TELAIO", "TARGA", "DATA DEL FERMO", "OFFICINA", "MOTIVO DEL FERMO",
        "AGGIORNAMENTI", "RIFERIMENTO", "DATA ATTESA PREVISTA", "EMAIL OFFICINA",
        "EMAIL LEASING", "DATA INVIO SOLLECITO", "COSTO GIORNALIERO (€/gg)", "STATO PRATICA", "SEDE DI RIFERIMENTO"
      ]]);
      formattaFoglioFermi(target, nomeTarget);
      invalidaCacheIntestazioni(nomeTarget);
    }

    const nColOrig = foglioOrigine.getLastColumn();
    const rigaOrig = foglioOrigine.getRange(rigaIndex, 1, 1, nColOrig).getValues()[0];
    const idvOrig = getIdentificativoVeicolo(rigaOrig, colOrig);
    if (!idvOrig.valore) return;

    const intTarget = leggiIntestazioniCached(target);
    const colTarget = mappaColonne(intTarget);
    const colStatoT = trovaColonnaStato(intTarget);
    const rigaHT = trovaRigaHeader(target);
    const nColTarget = target.getLastColumn();
    const nuovaRiga = new Array(nColTarget).fill("");

    const mapOrig = {};
    intestazioniOrig.forEach((h, i) => { mapOrig[safeStr(h).toUpperCase()] = i; });

    intTarget.forEach((h, i) => {
      const idxO = mapOrig[safeStr(h).toUpperCase()];
      if (idxO !== undefined && idxO >= 0 && idxO < rigaOrig.length) {
        nuovaRiga[i] = rigaOrig[idxO];
      }
    });

    if (colTarget.sedeRiferimento >= 0) nuovaRiga[colTarget.sedeRiferimento] = sede;
    if (colStatoT > 0 && !safeStr(nuovaRiga[colStatoT - 1])) nuovaRiga[colStatoT - 1] = "🟢 APERTO";

    let nRigaTarget = 0;
    const esistente = trovaRigaFermoPerIdentificativo(target, colTarget, rigaHT, idvOrig.valore);
    if (esistente > 0) {
      nRigaTarget = esistente;
      target.getRange(nRigaTarget, 1, 1, nColTarget).setValues([nuovaRiga]);
    } else {
      nRigaTarget = target.getLastRow() + 1;
      target.getRange(nRigaTarget, 1, 1, nColTarget).setValues([nuovaRiga]);
    }

    const tema = getTemaFoglio(nomeTarget);
    formattaRigaDati(target, nRigaTarget, nuovaRiga, intTarget, colTarget, tema, Math.max(0, nRigaTarget - 5));

    if (colStatoT > 0) {
      const cSt = target.getRange(nRigaTarget, colStatoT);
      applicaDropdownStato(cSt);
      coloraCellaStato(cSt, safeStr(cSt.getValue()).toUpperCase() || "APERTO");
    }
    if (colTarget.sedeRiferimento >= 0) {
      applicaDropdownSedeRiferimento(target.getRange(nRigaTarget, colTarget.sedeRiferimento + 1));
    }

    SpreadsheetApp.flush();

    const rowTargetScritta = target.getRange(nRigaTarget, 1, 1, nColTarget).getValues()[0];
    const idvCheck = getIdentificativoVeicolo(rowTargetScritta, colTarget);
    if (safeStr(idvCheck.valore).toUpperCase() !== safeStr(idvOrig.valore).toUpperCase()) {
      scriviLog([[
        new Date(),
        safeStr(idvOrig.valore).toUpperCase(),
        "ERRORE spostamento sede: verifica identificativo fallita. Riga origine non eliminata."
      ]]);
      ss.toast("⚠️ Errore verifica spostamento sede. Controlla LOG_ERRORI.", "❌", 10);
      return;
    }

    foglioOrigine.deleteRow(rigaIndex);
    aggiornaSommarioFoglio(foglioOrigine, nomeOrigine);
    aggiornaSommarioFoglio(target, nomeTarget);

    ss.toast("✅ " + idvOrig.valore + " spostata in " + nomeTarget, "Sede aggiornata", 6);
  } catch (e) {
    scriviLog([[new Date(), "spostaRigaPerSede", e.toString()]]);
    ss.toast("❌ Errore spostamento sede: " + e.message, "Sede", 8);
  }
}

/* ----------------------------------------------------------------
   SEZIONE 6 — RIAPERTURA
   ---------------------------------------------------------------- */

function riapriDaArchivio(arch, rigaArch, intestazioniArch) {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = leggiConfig();
  riparaRigheArchivioDisallineate(arch);
  const dati = arch.getRange(rigaArch, 1, 1, arch.getLastColumn()).getValues()[0];

  const aIdx = label => intestazioniArch.findIndex(h => h === label);

  const tipo = aIdx("TIPO FERMO") >= 0 ? safeStr(dati[aIdx("TIPO FERMO")]).toUpperCase() : "STANDARD";
  const sede = aIdx("SEDE") >= 0 ? safeStr(dati[aIdx("SEDE")]) : "";
  const isCopart = tipo === "COPART" || safeStr(sede).toUpperCase() === "COPART";

  let nomeTarget = isCopart ? cfg.FOGLIO_COPART : (sede ? "FERMI TECNICI " + sede : cfg.NOMI_FOGLI[0]);

  let target = ss.getSheetByName(nomeTarget);
  if (!target) {
    target = ss.insertSheet(nomeTarget);
    formattaFoglioFermi(target, nomeTarget);
    invalidaCacheIntestazioni(nomeTarget);
  }

  const intTarget   = leggiIntestazioniCached(target);
  const colTarget   = mappaColonne(intTarget);
  const colStatoT   = trovaColonnaStato(intTarget);
  const nColTarget  = target.getLastColumn();
  const nuovaRiga   = new Array(nColTarget).fill("");

  const scrivi = (colT0, valArch) => {
    if (colT0 >= 0 && colT0 < nColTarget && valArch !== undefined) nuovaRiga[colT0] = valArch;
  };

  const identificativoArch = dati[aIdx("TARGA")];

  scrivi(colTarget.modello,         dati[aIdx("MODELLO")]);
  if (isCopart && colTarget.telaio >= 0) {
    scrivi(colTarget.telaio,        identificativoArch);
  } else {
    scrivi(colTarget.targa,         identificativoArch);
  }
  scrivi(colTarget.dataFermo,       dati[aIdx("DATA DEL FERMO")]);
  scrivi(colTarget.officina,        dati[aIdx("OFFICINA")]);
  scrivi(colTarget.motivo,          dati[aIdx("MOTIVO DEL FERMO")]);
  scrivi(colTarget.aggiornamenti,   dati[aIdx("AGGIORNAMENTI")]);
  scrivi(colTarget.riferimento,     dati[aIdx("RIFERIMENTO")]);
  scrivi(colTarget.dataAttesa,      dati[aIdx("DATA ATTESA PREVISTA")]);
  scrivi(colTarget.emailOff,        dati[aIdx("EMAIL OFFICINA")]);
  scrivi(colTarget.emailLeas,       dati[aIdx("EMAIL LEASING")]);
  scrivi(colTarget.dataInvio,       dati[aIdx("DATA INVIO SOLLECITO")]);
  scrivi(colTarget.costoGiornaliero, dati[aIdx("COSTO GIORNALIERO (€/gg)")]);

  if (colStatoT > 0) nuovaRiga[colStatoT - 1] = "🟢 APERTO";

  const nRigaTarget = target.getLastRow() + 1;
  target.getRange(nRigaTarget, 1, 1, nColTarget).setValues([nuovaRiga]);

  const tema = getTemaFoglio(nomeTarget);
  formattaRigaDati(target, nRigaTarget, nuovaRiga, intTarget, colTarget, tema, nRigaTarget - 5);

  if (colStatoT > 0) {
    const c = target.getRange(nRigaTarget, colStatoT);
    applicaDropdownStato(c);
    coloraCellaStato(c, "APERTO");
  }

  arch.deleteRow(rigaArch);
  aggiornaRiepilogoArchivio(arch);
  aggiornaSommarioFoglio(target, nomeTarget);
  aggiornaReportCosti(ss);
  aggiornaReportCostiCopart(ss);

  const targa = safeStr(dati[aIdx("TARGA")]) || "—";
  ss.toast("Pratica " + targa + " riaperta → " + nomeTarget, "🔄 Riaperta", 6);
}

/* ----------------------------------------------------------------
   SEZIONE 7 — SOMMARIO LIVE DEL FOGLIO
   ---------------------------------------------------------------- */

function aggiornaSommarioFoglio(foglio, nomeFoglio) {
  const rigaH = trovaRigaHeader(foglio);
  const nCol  = foglio.getLastColumn();
  if (nCol < 1 || rigaH < 2) return;

  const ultima       = foglio.getLastRow();
  const intestazioni = leggiIntestazioniCached(foglio);
  const col          = mappaColonne(intestazioni);
  const colStato     = trovaColonnaStato(intestazioni) - 1;

  let tot = 0, chiuse = 0;

  if (ultima > rigaH) {
    const datiRighe = foglio.getRange(rigaH + 1, 1, ultima - rigaH, nCol).getValues();
    datiRighe.forEach(r => {
      if (!rigaHaDatiPratica(r, colStato)) return;
      tot++;
      const statoP = colStato >= 0 ? r[colStato].toString().toUpperCase() : "";
      const statoA = col.aggiornamenti >= 0 ? r[col.aggiornamenti].toString().toLowerCase() : "";
      if (statoP.includes("CHIUSO") || statoA.includes("chiuso") || statoA.includes("consegnata") || statoA.includes("ritirata")) chiuse++;
    });
  }
  const aperte = tot - chiuse;

  const rigaSommario = rigaH - 2;
  if (rigaSommario < 1) return;

  foglio.getRange(rigaSommario, 2).setValue(tot);
  foglio.getRange(rigaSommario, 4).setValue(aperte);
  foglio.getRange(rigaSommario, 6).setValue(chiuse);
  foglio.getRange(rigaSommario, nCol)
    .setValue("Aggiornato: " + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm"));
}

/* ----------------------------------------------------------------
   SEZIONE 8 — ARCHIVIO
   ---------------------------------------------------------------- */

function inizializzaArchivio(arch) {
  const n = ARCH_COLS.length;

  arch.getRange(1, 1, 1, n).merge()
    .setValue("📦   ARCHIVIO STORICO FERMI TECNICI — GRETA S.R.L.")
    .setBackground("#0d1b2a").setFontColor("#e8f4fd")
    .setFontSize(14).setFontWeight("bold")
    .setHorizontalAlignment("center").setVerticalAlignment("middle");
  arch.setRowHeight(1, 44);

  arch.getRange(2, 1, 1, n).setBackground("#e8eaf6");
  arch.getRange("A2").setValue("Pratiche archiviate:").setFontWeight("bold").setFontColor("#1a237e");
  arch.getRange("B2").setValue(0).setFontWeight("bold").setFontColor("#1a237e").setHorizontalAlignment("center");
  arch.getRange("C2").setValue("Media giorni fermo:").setFontWeight("bold").setFontColor("#1a237e");
  arch.getRange("D2").setValue("—").setFontWeight("bold").setFontColor("#1a237e").setHorizontalAlignment("center");
  arch.getRange("E2").setValue("Ultimo aggiornamento:").setFontWeight("bold").setFontColor("#1a237e");
  arch.getRange("F2").setValue("—").setFontWeight("bold").setFontColor("#1a237e");
  arch.getRange(2, 1, 1, n)
    .setBorder(true, true, true, true, false, false, "#c5cae9", SpreadsheetApp.BorderStyle.SOLID);
  arch.setRowHeight(2, 28);

  arch.getRange(3, 1, 1, n).setBackground("#3949ab");
  arch.setRowHeight(3, 4);

  arch.getRange(4, 1, 1, n)
    .setValues([ARCH_COLS])
    .setBackground("#1a237e").setFontColor("#ffffff")
    .setFontWeight("bold").setFontSize(10)
    .setHorizontalAlignment("center").setVerticalAlignment("middle")
    .setBorder(true, true, true, true, true, true, "#3949ab", SpreadsheetApp.BorderStyle.SOLID);
  arch.setRowHeight(4, 32);

  ARCH_WIDTHS.forEach((w, i) => arch.setColumnWidth(i + 1, w));
  arch.setFrozenRows(4);
  arch.setFrozenColumns(0);
}

function getMetaArchivio(arch) {
  const lastCol = arch.getLastColumn();
  const headers = (arch.getLastRow() >= 4 && lastCol > 0)
    ? arch.getRange(4, 1, 1, lastCol).getValues()[0].map(h => safeStr(h).toUpperCase())
    : [];
  const idx = label => headers.findIndex(h => h === label);
  const headerA = headers.length > 0 ? headers[0] : "";
  const headerB = headers.length > 1 ? headers[1] : "";
  const schemaNuovo = headerA === "TIPO FERMO" && headerB === "SEDE";

  return {
    headers,
    schemaNuovo,
    col: {
      tipo         : idx("TIPO FERMO"),
      sede         : idx("SEDE"),
      modello      : idx("MODELLO"),
      targa        : idx("TARGA"),
      dataFermo    : idx("DATA DEL FERMO"),
      officina     : idx("OFFICINA"),
      motivo       : idx("MOTIVO DEL FERMO"),
      aggiornamenti: idx("AGGIORNAMENTI"),
      riferimento  : idx("RIFERIMENTO"),
      dataAttesa   : idx("DATA ATTESA PREVISTA"),
      emailOff     : idx("EMAIL OFFICINA"),
      emailLeas    : idx("EMAIL LEASING"),
      dataInvio    : idx("DATA INVIO SOLLECITO"),
      stato        : idx("STATO PRATICA"),
      dataChiusura : idx("DATA CHIUSURA"),
      giorni       : idx("TOT. GIORNI FERMO"),
      costoG       : idx("COSTO GIORNALIERO (€/gg)"),
      costoT       : idx("COSTO TOTALE (€)"),
      fascia       : idx("FASCIA DURATA")
    }
  };
}

function riparaRigheArchivioDisallineate(arch) {
  const meta = getMetaArchivio(arch);
  if (meta.schemaNuovo) return 0;
  if (!arch || arch.getLastRow() < 5) return 0;

  const nCol = arch.getLastColumn();
  const rng = arch.getRange(5, 1, arch.getLastRow() - 4, nCol);
  const dati = rng.getValues();

  const sediValide = ["BN", "RM", "MI", "MILANO", "ROMA", "SGS", "COPART", "N/D"];
  const isStato = v => {
    const s = safeStr(v).toUpperCase();
    return s.includes("APERTO") || s.includes("CHIUSO");
  };
  const isData = v => toDate(v) !== null;
  let fixCount = 0;

  for (let i = 0; i < dati.length; i++) {
    const c0 = safeStr(dati[i][0]).toUpperCase();
    const c1 = safeStr(dati[i][1]).toUpperCase();
    const tipoInSede = c0 === "STANDARD" || c0 === "COPART";
    const sedeInModello = sediValide.includes(c1);

    // Vecchia intestazione (senza TIPO FERMO) + riga scritta col nuovo schema:
    // la riga è traslata di +1 colonna, quindi va riportata indietro.
    if (tipoInSede && sedeInModello) {
      const riallineata = dati[i].slice(1);
      while (riallineata.length < nCol) riallineata.push("");
      dati[i] = riallineata.slice(0, nCol);
      fixCount++;
    }

    // Caso visto in archivio: stato duplicato su STATO+DATA CHIUSURA
    // e data/giorni/costi spostati a destra di una colonna.
    // Schema vecchio atteso:
    // 12 STATO, 13 DATA_CHIUSURA, 14 GIORNI, 15 COSTO_G, 16 COSTO_T, 17 FASCIA
    if (nCol >= 18) {
      const cStato = dati[i][12];
      const cData  = dati[i][13];
      const cGg    = dati[i][14];
      const cCg    = dati[i][15];
      const cCt    = dati[i][16];
      const cFa    = dati[i][17];

      if (isStato(cStato) && isStato(cData) && isData(cGg)) {
        dati[i][12] = "🔴 CHIUSO";
        dati[i][13] = cGg;
        dati[i][14] = cCg;
        dati[i][15] = cCt;
        dati[i][16] = cFa;
        dati[i][17] = "";
        fixCount++;
      }
    }
  }

  if (fixCount > 0) rng.setValues(dati);
  return fixCount;
}

function formattaRigaArchivio(arch, nRiga, giorniTot, fascia, alterno) {
  const meta = getMetaArchivio(arch);
  const n  = arch.getLastColumn();
  const rg = arch.getRange(nRiga, 1, 1, n);
  rg.setBackground(alterno ? "#f0f4ff" : "#ffffff")
    .setFontSize(10).setVerticalAlignment("middle")
    .setBorder(false, false, true, false, false, false, "#dde3f0", SpreadsheetApp.BorderStyle.SOLID);
  arch.setRowHeight(nRiga, 26);

  const colTipoVis = meta.schemaNuovo ? meta.col.tipo + 1 : meta.col.sede + 1;
  const colSede    = meta.col.sede >= 0 ? meta.col.sede + 1 : 0;
  const colId      = meta.col.targa >= 0 ? meta.col.targa + 1 : 0;
  const colAgg     = meta.col.aggiornamenti >= 0 ? meta.col.aggiornamenti + 1 : 0;

  if (colTipoVis > 0) arch.getRange(nRiga, colTipoVis).setFontWeight("bold").setHorizontalAlignment("center");
  if (colSede > 0) arch.getRange(nRiga, colSede).setFontWeight("bold").setFontColor("#3949ab").setHorizontalAlignment("center");
  if (colId > 0) arch.getRange(nRiga, colId).setFontWeight("bold").setFontFamily("Courier New").setHorizontalAlignment("center").setFontColor("#1a237e");

  [meta.col.dataFermo, meta.col.dataAttesa, meta.col.dataInvio, meta.col.dataChiusura]
    .filter(i => i >= 0)
    .forEach(i => arch.getRange(nRiga, i + 1).setHorizontalAlignment("center").setFontColor("#546e7a"));

  [meta.col.emailOff, meta.col.emailLeas]
    .filter(i => i >= 0)
    .forEach(i => arch.getRange(nRiga, i + 1).setFontColor("#90a4ae").setFontSize(9));

  if (colAgg > 0) arch.getRange(nRiga, colAgg).setWrap(true);

  const tipo = meta.schemaNuovo
    ? safeStr(arch.getRange(nRiga, meta.col.tipo + 1).getValue()).toUpperCase()
    : (safeStr(arch.getRange(nRiga, meta.col.sede + 1).getValue()).toUpperCase() === "COPART" ? "COPART" : "STANDARD");

  if (tipo === "COPART" && colTipoVis > 0) {
    arch.getRange(nRiga, colTipoVis).setBackground("#efebe9").setFontColor("#5d4037");
  } else {
    if (colTipoVis > 0) arch.getRange(nRiga, colTipoVis).setBackground("#e8eaf6").setFontColor("#1a237e");
  }

  const colStatoN = meta.col.stato >= 0 ? meta.col.stato + 1 : 0;
  if (colStatoN > 0) {
    const v = arch.getRange(nRiga, colStatoN).getValue().toString().toUpperCase();
    coloraCellaStato(arch.getRange(nRiga, colStatoN), v);
  }

  const colG = meta.col.giorni >= 0 ? meta.col.giorni + 1 : 0;
  if (colG > 0 && giorniTot !== null) {
    const cg = arch.getRange(nRiga, colG);
    cg.setFontWeight("bold").setFontSize(12).setHorizontalAlignment("center");
    if      (giorniTot > 60) cg.setFontColor("#b71c1c").setBackground("#ffebee");
    else if (giorniTot > 30) cg.setFontColor("#e65100").setBackground("#fff3e0");
    else if (giorniTot > 15) cg.setFontColor("#f57f17").setBackground("#fffde7");
    else if (giorniTot > 7)  cg.setFontColor("#2e7d32").setBackground("#f1f8e9");
    else                      cg.setFontColor("#1b5e20").setBackground("#e8f5e9");
  }

  const colF = meta.col.fascia >= 0 ? meta.col.fascia + 1 : 0;
  if (colF > 0) {
    const cf = arch.getRange(nRiga, colF);
    cf.setFontWeight("bold").setHorizontalAlignment("center").setFontSize(10);
    if      (fascia.includes("Critica")) cf.setFontColor("#b71c1c").setBackground("#ffcdd2");
    else if (fascia.includes("Lunga"))   cf.setFontColor("#e65100").setBackground("#ffe0b2");
    else if (fascia.includes("Media"))   cf.setFontColor("#f57f17").setBackground("#fff9c4");
    else if (fascia.includes("Breve"))   cf.setFontColor("#558b2f").setBackground("#f0f4c3");
    else if (fascia.includes("Rapida"))  cf.setFontColor("#1b5e20").setBackground("#c8e6c9");
    else                                  cf.setFontColor("#9e9e9e");
  }
}

function aggiornaRiepilogoArchivio(arch) {
  const meta = getMetaArchivio(arch);
  const ultima = arch.getLastRow();
  if (ultima < 5) {
    arch.getRange("B2").setValue(0);
    arch.getRange("D2").setValue("—");
    arch.getRange("F2").setValue("—");
    return;
  }
  const count  = ultima - 4;
  const colG   = meta.col.giorni >= 0 ? meta.col.giorni + 1 : 0;
  let somma = 0, cnt = 0;
  if (colG > 0) {
    arch.getRange(5, colG, count, 1).getValues().forEach(r => {
      const v = parseFloat(r[0]);
      if (!isNaN(v) && v > 0) { somma += v; cnt++; }
    });
  }
  arch.getRange("B2").setValue(count);
  arch.getRange("D2").setValue(cnt > 0 ? Math.round(somma / cnt) + " gg" : "—");
  arch.getRange("F2").setValue(Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm"));
}

function riformattaArchivio() {
  const ss   = SpreadsheetApp.getActiveSpreadsheet();
  const cfg  = leggiConfig();
  const arch = ss.getSheetByName(cfg.FOGLIO_ARCHIVIO);
  if (!arch) { safeAlert("Errore", "Foglio archivio non trovato."); return; }
  const nFix = riparaRigheArchivioDisallineate(arch);
  if (getMetaArchivio(arch).schemaNuovo) inizializzaArchivio(arch);
  const meta = getMetaArchivio(arch);
  const ultima = arch.getLastRow();
  for (let r = 5; r <= ultima; r++) {
    const g = meta.col.giorni >= 0 ? parseFloat(arch.getRange(r, meta.col.giorni + 1).getValue()) : null;
    const f = meta.col.fascia >= 0 ? arch.getRange(r, meta.col.fascia + 1).getValue().toString() : "";
    formattaRigaArchivio(arch, r, isNaN(g) ? null : g, f, r % 2 === 0);
  }
  aggiornaRiepilogoArchivio(arch);
  safeAlert("✅ Archivio riformattato", nFix > 0 ? ("Righe riallineate: " + nFix) : "Nessuna riga disallineata trovata.");
}

/* ----------------------------------------------------------------
   SEZIONE 9 — REPORT COSTI
   ---------------------------------------------------------------- */

function aggiornaReportCosti(ss) {
  return aggiornaReportCostiPerTipo("STANDARD", ss);
}

function aggiornaReportCostiCopart(ss) {
  return aggiornaReportCostiPerTipo("COPART", ss);
}

function ricalcolaReportCosti() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  aggiornaReportCosti(ss);
  aggiornaReportCostiCopart(ss);
}

function aggiornaReportCostiPerTipo(tipo, ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  const cfg  = leggiConfig();

  const arch = ss.getSheetByName(cfg.FOGLIO_ARCHIVIO);
  if (!arch || arch.getLastRow() < 5) {
    ss.toast("Archivio vuoto o non trovato.", "Report Costi", 5);
    return;
  }

  riparaRigheArchivioDisallineate(arch);

  const meta    = getMetaArchivio(arch);
  const iTipo   = meta.col.tipo;
  const iSede   = meta.col.sede;
  const iTarga  = meta.col.targa;
  const iMod    = meta.col.modello;
  const iOff    = meta.col.officina;
  const iMot    = meta.col.motivo;
  const iData   = meta.col.dataFermo;
  const iChius  = meta.col.dataChiusura;
  const iGiorni = meta.col.giorni;
  const iCostoG = meta.col.costoG;
  const iCostoT = meta.col.costoT;
  const iFascia = meta.col.fascia;

  let datiArch = arch.getRange(5, 1, arch.getLastRow() - 4, arch.getLastColumn()).getValues();
  datiArch = datiArch.filter(r => {
    const identificativo = iTarga >= 0 ? safeStr(r[iTarga]) : "";
    const modello = iMod >= 0 ? safeStr(r[iMod]) : "";
    if (!identificativo && !modello) return false;
    const sedeRiga = iSede >= 0 ? safeStr(r[iSede]).toUpperCase() : "";
    const tipoRiga = iTipo >= 0 ? safeStr(r[iTipo]).toUpperCase() : (sedeRiga === "COPART" ? "COPART" : "STANDARD");
    return tipo === "COPART" ? tipoRiga === "COPART" : tipoRiga !== "COPART";
  });

  const nomeReport = getNomeReportPerTipo(tipo);
  const vecchio = ss.getSheetByName(nomeReport);
  if (vecchio) ss.deleteSheet(vecchio);
  const rep = ss.insertSheet(nomeReport);
  ss.moveActiveSheet(ss.getNumSheets());

  const tema = tipo === "COPART"
    ? { head: "#3e2723", accent: "#6d4c41", soft: "#efebe9", text: "#5d4037" }
    : { head: "#0d1b2a", accent: "#1a237e", soft: "#e8eaf6", text: "#1a237e" };

  const ora = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm");
  rep.getRange(1,1,1,11).merge()
    .setValue(tipo === "COPART"
      ? "📊  REPORT COSTI FERMI TECNICI COPART — GRETA S.R.L."
      : "📊  REPORT COSTI FERMI TECNICI — GRETA S.R.L.")
    .setBackground(tema.head).setFontColor("#ffffff")
    .setFontSize(15).setFontWeight("bold")
    .setHorizontalAlignment("center").setVerticalAlignment("middle");
  rep.setRowHeight(1, 48);

  rep.getRange(2,1,1,11).merge()
    .setValue("🕐  Aggiornato: " + ora)
    .setBackground(tema.soft).setFontColor(tema.text)
    .setFontWeight("bold").setHorizontalAlignment("left");

  if (datiArch.length === 0) {
    rep.getRange(4,1,1,11).merge()
      .setValue(tipo === "COPART" ? "Nessuna pratica COPART archiviata." : "Nessuna pratica standard archiviata.")
      .setHorizontalAlignment("center");
    return;
  }

  let totPratiche=0, totGiorni=0, totCosto=0, cntG=0, cntC=0;
  const perSede={}, sedeKeys=[], righeDettaglio=[];

  datiArch.forEach(r => {
    const identificativo = iTarga >= 0 ? safeStr(r[iTarga]) : "";
    const modello = iMod >= 0 ? safeStr(r[iMod]) : "";
    if (!identificativo && !modello) return;
    totPratiche++;
    const sedeRaw = safeStr(r[iSede]);
    const sede    = sedeRaw.toUpperCase().trim() || "N/D";
    if (!perSede[sede]) { perSede[sede]={pratiche:0,giorni:0,costo:0,cntG:0,cntC:0}; sedeKeys.push(sede); }

    const gg  = parseFloat(r[iGiorni]);
    const cgG = parseFloat(r[iCostoG]);
    const cos = (!isNaN(cgG)&&cgG>0&&!isNaN(gg)&&gg>0) ? cgG*gg : parseFloat(r[iCostoT]);

    if (!isNaN(gg)&&gg>0)   { totGiorni+=gg; cntG++; perSede[sede].giorni+=gg; perSede[sede].cntG++; }
    if (!isNaN(cos)&&cos>0) { totCosto+=cos;  cntC++; perSede[sede].costo+=cos; perSede[sede].cntC++; }
    perSede[sede].pratiche++;

    righeDettaglio.push([
      sedeRaw, safeStr(r[iMod]), safeStr(r[iTarga]), safeStr(r[iOff]), safeStr(r[iMot]),
      toDate(r[iData])||"", toDate(r[iChius])||"",
      (!isNaN(gg)&&gg>0)   ? Math.round(gg) : "",
      (!isNaN(cgG)&&cgG>0) ? cgG             : "",
      (!isNaN(cos)&&cos>0) ? Math.round(cos) : "",
      safeStr(r[iFascia])
    ]);
  });

  const mediaGG  = cntG>0 ? Math.round(totGiorni/cntG) : 0;
  const mediaCos = cntC>0 ? Math.round(totCosto/cntC)  : 0;
  const nSedi    = sedeKeys.length;
  const nDet     = righeDettaglio.length;
  const NC       = 11;

  rep.getRange(4,1,1,8).setValues([[
    "Pratiche Chiuse", totPratiche,
    "Giorni Medi", mediaGG,
    "Costo Totale (€)", totCosto,
    "Costo Medio (€)", mediaCos
  ]]).setBackground("#f5f5f5").setFontWeight("bold");

  rep.getRange(6,1,1,6)
    .setValues([["SEDE","PRATICHE","GG TOTALI","GG MEDI","COSTO TOTALE (€)","COSTO MEDIO (€)"]])
    .setBackground(tema.accent).setFontColor("#eceff1").setFontWeight("bold").setFontSize(9)
    .setHorizontalAlignment("center").setVerticalAlignment("middle");
  rep.setRowHeight(6, 24);

  sedeKeys.forEach((s,i) => {
    const sd=perSede[s], nr=7+i, bg=i%2===0?"#eceff1":"#ffffff";
    const ggT=sd.cntG>0?Math.round(sd.giorni):0;
    const ggM=sd.cntG>0?Math.round(sd.giorni/sd.cntG):0;
    const cosT=sd.cntC>0?Math.round(sd.costo):0;
    const cosM=sd.cntC>0?Math.round(sd.costo/sd.cntC):0;
    rep.getRange(nr,1,1,6).setValues([[s,sd.pratiche,ggT,ggM,cosT,cosM]])
      .setBackground(bg).setFontSize(10).setHorizontalAlignment("center").setVerticalAlignment("middle");
    rep.getRange(nr,1).setFontWeight("bold").setFontColor(tema.text);
    rep.getRange(nr,3).setNumberFormat('0 "gg"');
    rep.getRange(nr,4).setNumberFormat('0 "gg"');
    rep.getRange(nr,5).setNumberFormat('"€ "#,##0').setFontWeight("bold");
    rep.getRange(nr,6).setNumberFormat('"€ "#,##0');
    rep.setRowHeight(nr, 26);
  });

  const R_DET_HDR = 9+nSedi;
  rep.getRange(R_DET_HDR,1,1,NC)
    .setValues([["SEDE","MODELLO","TARGA","OFFICINA","MOTIVO DEL FERMO","DATA FERMO","DATA CHIUSURA","GG","€/GG","COSTO TOT","FASCIA"]])
    .setBackground(tema.accent).setFontColor("#cfd8dc").setFontWeight("bold").setFontSize(9)
    .setHorizontalAlignment("center").setVerticalAlignment("middle");
  rep.setRowHeight(R_DET_HDR, 24);

  if (nDet > 0) {
    const R0 = R_DET_HDR+1;
    rep.getRange(R0,1,nDet,NC).setValues(righeDettaglio).setFontSize(9).setVerticalAlignment("middle");
    rep.getRange(R0,6,nDet,1).setNumberFormat("dd/mm/yyyy").setHorizontalAlignment("center");
    rep.getRange(R0,7,nDet,1).setNumberFormat("dd/mm/yyyy").setHorizontalAlignment("center");
    rep.getRange(R0,8,nDet,1).setNumberFormat('0 "gg"').setHorizontalAlignment("center");
    rep.getRange(R0,9,nDet,1).setNumberFormat('"€ "#,##0.00').setHorizontalAlignment("center");
    rep.getRange(R0,10,nDet,1).setNumberFormat('"€ "#,##0').setHorizontalAlignment("center");
    rep.getRange(R0,11,nDet,1).setHorizontalAlignment("center");
    righeDettaglio.forEach((r,i) => {
      const nr=R0+i;
      rep.getRange(nr,1,1,NC).setBackground(i%2===0?"#fafafa":"#ffffff");
      rep.setRowHeight(nr, 22);
      rep.getRange(nr,1).setFontColor(tema.text).setFontWeight("bold").setHorizontalAlignment("center");
      rep.getRange(nr,3).setFontFamily("Courier New").setFontWeight("bold");
    });
  }

  [100,130,82,140,175,92,100,52,65,92,120].forEach((w,i)=>rep.setColumnWidth(i+1,w));
  rep.setFrozenRows(R_DET_HDR);
}

/* ----------------------------------------------------------------
   SEZIONE 10 — COLONNA STATO PRATICA + ARCHIVIAZIONE BATCH
   ---------------------------------------------------------------- */

function aggiungiColonnaStato() {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const log = [];

  getNomiFogliOperativi().forEach(nome => {
    const f = ss.getSheetByName(nome);
    if (!f) { log.push(nome + ": foglio non trovato."); return; }

    const rigaH = trovaRigaHeader(f);
    const intestazioni = leggiIntestazioniCached(f);
    let colStato = trovaColonnaStato(intestazioni);

    if (colStato <= 0) {
      colStato = f.getLastColumn() + 1;
      f.getRange(rigaH, colStato)
        .setValue("STATO PRATICA")
        .setBackground(getTemaFoglio(nome).bg)
        .setFontColor("#ffffff")
        .setFontWeight("bold")
        .setHorizontalAlignment("center");
      f.setColumnWidth(colStato, 120);
      invalidaCacheIntestazioni(nome);
      log.push(nome + ": colonna creata");
    } else {
      log.push(nome + ": colonna già presente, dropdown ripristinato");
    }

    const ultima = f.getLastRow();
    if (ultima <= rigaH) return;
    const primaRigaDati = rigaH + 1;
    const datiRighe = f.getRange(primaRigaDati, 1, ultima - rigaH, f.getLastColumn()).getValues();
    for (let i = 0; i < datiRighe.length; i++) {
      const cella = f.getRange(primaRigaDati + i, colStato);
      const idxStato0 = colStato - 1;
      if (!rigaHaDatiPratica(datiRighe[i], idxStato0)) {
        cella.clearContent().clearDataValidations().setBackground(null).setFontColor(null).setFontWeight("normal");
        continue;
      }

      applicaDropdownStato(cella);
      const v = safeStr(cella.getValue()).toUpperCase();

      if (!v) {
        cella.setValue("🟢 APERTO");
        coloraCellaStato(cella, "APERTO");
      } else if (v.includes("CHIUSO")) {
        cella.setValue("🔴 CHIUSO");
        coloraCellaStato(cella, "CHIUSO");
      } else {
        cella.setValue("🟢 APERTO");
        coloraCellaStato(cella, "APERTO");
      }
    }
  });

  safeAlert("✅ Dropdown stato aggiornato", log.join("\n"));
}


function archiviaPraticheChiuse() {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  let count = 0;

  getNomiFogliOperativi().forEach(nome => {
    const f = ss.getSheetByName(nome);
    if (!f || f.getLastRow() < 2) return;

    const rigaH        = trovaRigaHeader(f);
    const intestazioni = leggiIntestazioniCached(f);
    const col          = mappaColonne(intestazioni);
    const colStato     = trovaColonnaStato(intestazioni);
    const dati         = f.getDataRange().getValues();

    for (let i = dati.length - 1; i >= rigaH; i--) {
      const idv = getIdentificativoVeicolo(dati[i], col);
      if (!idv.valore) continue;
      const statoP = colStato > 0 ? dati[i][colStato - 1].toString().toUpperCase() : "";
      const statoA = col.aggiornamenti >= 0 ? dati[i][col.aggiornamenti].toString().toLowerCase() : "";
      const chiuso = statoP.includes("CHIUSO") || statoA.includes("chiuso") || statoA.includes("consegnata") || statoA.includes("ritirata");
      if (chiuso) {
        spostaInArchivio(f, i + 1, col, colStato - 1, nome, intestazioni);
        count++;
      }
    }
  });

  safeAlert("✅ Archiviate", count + " pratiche chiuse spostate in archivio.");
}

function pulisciStoricoAggiornamentiEsistenti() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let fixTot = 0;
  const log = [];

  getNomiFogliOperativi().forEach(nome => {
    const f = ss.getSheetByName(nome);
    if (!f) {
      log.push("❌ " + nome + ": foglio non trovato");
      return;
    }

    const rigaH = trovaRigaHeader(f);
    const int = leggiIntestazioni(f);
    const col = mappaColonne(int);
    if (col.aggiornamenti < 0) {
      log.push("ℹ️ " + nome + ": colonna AGGIORNAMENTI non trovata");
      return;
    }

    const last = f.getLastRow();
    if (last <= rigaH) {
      log.push("ℹ️ " + nome + ": nessuna riga dati");
      return;
    }

    const nRighe = last - rigaH;
    const rg = f.getRange(rigaH + 1, col.aggiornamenti + 1, nRighe, 1);
    const vals = rg.getValues();
    let fixFoglio = 0;

    for (let i = 0; i < vals.length; i++) {
      const cur = safeStr(vals[i][0]);
      if (!cur) continue;
      const pulito = normalizzaAggiornamentoSingolo(cur);
      if (pulito !== cur) {
        vals[i][0] = pulito;
        fixFoglio++;
        fixTot++;
      }
    }

    if (fixFoglio > 0) rg.setValues(vals);
    log.push("✅ " + nome + ": " + fixFoglio + " celle pulite");
  });

  safeAlert("🧽 Pulizia aggiornamenti completata", "Totale celle pulite: " + fixTot + "\n" + log.join("\n"));
}

/* ----------------------------------------------------------------
   [M5] TRIGGER SCHEDULATO GIORNALIERO
   ---------------------------------------------------------------- */

function installaTriggerGiornaliero() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === "eseguiJobGiornaliero")
    .forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger("eseguiJobGiornaliero")
    .timeBased()
    .everyDays(1)
    .atHour(8)
    .create();

  safeAlert("✅ Trigger installato", "Il job giornaliero verrà eseguito ogni giorno alle 08:00.\nComprende: invio solleciti + notifica fermi critici.");
}

function rimuoviTriggerGiornaliero() {
  const rimossi = ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === "eseguiJobGiornaliero");
  rimossi.forEach(t => ScriptApp.deleteTrigger(t));
  safeAlert(rimossi.length > 0 ? "✅ Trigger rimosso." : "ℹ️ Nessun trigger attivo da rimuovere.");
}

function eseguiJobGiornaliero() {
  try {
    processaTuttiIFogli();
  } catch(e) {
    scriviLog([[new Date(), "TRIGGER_SOLLECITI", e.toString()]]);
  }
  try {
    notificaFermiCritici();
  } catch(e) {
    scriviLog([[new Date(), "TRIGGER_NOTIFICA_CRITICI", e.toString()]]);
  }
}

/* ----------------------------------------------------------------
   [M6] NOTIFICHE EMAIL PER FERMI CRITICI
   ---------------------------------------------------------------- */

function notificaFermiCritici() {
  const cfg     = leggiConfig();
  const fermi   = raccogliFermiAperti();
  const critici = fermi.filter(f => f.gg >= cfg.GIORNI_URGENTE_2);

  if (critici.length === 0) return;

  const ora = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm");

  const sedeColor = {
    MILANO: "#1a237e",
    ROMA:   "#b71c1c",
    BN:     "#1b5e20",
    SGS:    "#6a1b9a"
  };

  const sedeBg = {
    MILANO: "#e8edff",
    ROMA:   "#fdecec",
    BN:     "#eaf7ea",
    SGS:    "#f3eafd"
  };

  const esc = v =>
    safeStr(v)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  const righeHtml = critici.map(f => {
    const coloreSede = sedeColor[f.sede] || "#455a64";
    const bgSede     = sedeBg[f.sede] || "#eceff1";
    const modello    = esc(f.modello || "—");
    const targa      = esc(f.targa || "—");
    const officina   = esc(f.officina || "—");
    const aggiorn    = esc(f.aggiornamenti || "Nessun aggiornamento");
    const dataFermo  = esc(f.dataFermoFmt || "—");

    return `
      <tr>
        <td style="padding:9px 8px;border-bottom:1px solid #ececec;vertical-align:middle;white-space:nowrap;">
          <span style="display:inline-block;padding:3px 8px;border-radius:999px;background:${bgSede};color:${coloreSede};font-size:10px;font-weight:bold;letter-spacing:.4px;white-space:nowrap;">
            ${esc(f.sede)}
          </span>
        </td>
        <td style="padding:9px 8px;border-bottom:1px solid #ececec;vertical-align:middle;white-space:nowrap;font-size:12px;font-weight:700;color:#1f2937;">
          ${modello}
        </td>
        <td style="padding:9px 8px;border-bottom:1px solid #ececec;vertical-align:middle;white-space:nowrap;">
          <span style="font-family:Courier New, monospace;font-size:13px;font-weight:bold;color:#0f172a;letter-spacing:1px;white-space:nowrap;">
            ${targa}
          </span>
        </td>
        <td style="padding:9px 8px;border-bottom:1px solid #ececec;vertical-align:middle;text-align:center;white-space:nowrap;">
          <span style="font-size:20px;font-weight:800;color:#c62828;line-height:1;white-space:nowrap;">${f.gg}</span>
          <span style="font-size:10px;color:#c62828;font-weight:bold;margin-left:3px;white-space:nowrap;">gg</span>
        </td>
        <td style="padding:9px 8px;border-bottom:1px solid #ececec;vertical-align:middle;white-space:nowrap;">
          <div style="font-size:11px;font-weight:600;color:#111827;white-space:nowrap;">${officina}</div>
          <div style="font-size:9px;color:#9ca3af;white-space:nowrap;">Dal ${dataFermo}</div>
        </td>
        <td style="padding:9px 8px;border-bottom:1px solid #ececec;vertical-align:middle;font-size:11px;color:#4b5563;line-height:1.2;max-width:220px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
          ${aggiorn}
        </td>
      </tr>
    `;
  }).join("");

  const htmlBody = `
    <!DOCTYPE html>
    <html>
    <body style="margin:0;padding:0;background:#f4f5f7;font-family:Arial,sans-serif;">
      <div style="max-width:860px;margin:0 auto;padding:24px;">
        <div style="background:#c62828;color:#ffffff;padding:22px 26px;border-radius:10px 10px 0 0;">
          <div style="font-size:28px;font-weight:800;line-height:1.2;">ALERT FERMI CRITICI</div>
          <div style="margin-top:8px;font-size:13px;opacity:.92;">GRETA S.R.L. — ${ora}</div>
        </div>
        <div style="background:#ffffff;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 10px 10px;padding:24px 26px;">
          <p style="margin:0 0 18px;font-size:16px;color:#1f2937;line-height:1.6;">
            <strong>${critici.length} veicoli</strong> risultano in fermo da oltre
            <strong>${cfg.GIORNI_URGENTE_2} giorni</strong>. È richiesto un intervento urgente.
          </p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;table-layout:auto;">
            <thead>
              <tr>
                <th style="padding:8px 8px;background:#f8f9fb;color:#8a8f98;font-size:10px;text-transform:uppercase;letter-spacing:.6px;text-align:left;border-bottom:1px solid #e5e7eb;white-space:nowrap;">Sede</th>
                <th style="padding:8px 8px;background:#f8f9fb;color:#8a8f98;font-size:10px;text-transform:uppercase;letter-spacing:.6px;text-align:left;border-bottom:1px solid #e5e7eb;white-space:nowrap;">Veicolo</th>
                <th style="padding:8px 8px;background:#f8f9fb;color:#8a8f98;font-size:10px;text-transform:uppercase;letter-spacing:.6px;text-align:left;border-bottom:1px solid #e5e7eb;white-space:nowrap;">Targa</th>
                <th style="padding:8px 8px;background:#f8f9fb;color:#8a8f98;font-size:10px;text-transform:uppercase;letter-spacing:.6px;text-align:center;border-bottom:1px solid #e5e7eb;white-space:nowrap;">Durata</th>
                <th style="padding:8px 8px;background:#f8f9fb;color:#8a8f98;font-size:10px;text-transform:uppercase;letter-spacing:.6px;text-align:left;border-bottom:1px solid #e5e7eb;white-space:nowrap;">Officina</th>
                <th style="padding:8px 8px;background:#f8f9fb;color:#8a8f98;font-size:10px;text-transform:uppercase;letter-spacing:.6px;text-align:left;border-bottom:1px solid #e5e7eb;white-space:nowrap;">Aggiornamento</th>
              </tr>
            </thead>
            <tbody>${righeHtml}</tbody>
          </table>
          <div style="margin-top:18px;padding-top:14px;border-top:1px solid #eeeeee;font-size:11px;color:#9ca3af;">
            GRETA Fleet Manager — notifica automatica giornaliera
          </div>
        </div>
      </div>
    </body>
    </html>
  `;

  MailApp.sendEmail({
    to: cfg.EMAIL_CAPO,
    subject: "🚨 [GRETA] " + critici.length + " fermi critici — " + ora,
    htmlBody: htmlBody,
    name: cfg.NOME_MITTENTE
  });
}

/* ----------------------------------------------------------------
   SEZIONE 11 — DASHBOARD KPI
   ----------------------------------------------------------------
   Lascia invariata la tua funzione generaModelloKPI se vuoi mantenere
   la dashboard standard separata da COPART.
   ---------------------------------------------------------------- */

/* ----------------------------------------------------------------
   SEZIONE 12 — INVIO EMAIL
   ----------------------------------------------------------------
   Lascia invariata processaTuttiIFogli se vuoi mantenere i solleciti
   standard separati da COPART.
   ---------------------------------------------------------------- */

/* ----------------------------------------------------------------
   SEZIONE 15 — UTILITY
   ---------------------------------------------------------------- */

function safeAlert(titolo, msg) {
  const testo = msg !== undefined ? msg : titolo;
  const label = msg !== undefined ? titolo : "GRETA PRO";
  SpreadsheetApp.getActiveSpreadsheet().toast(testo, label, 10);
}

function mappaColonne(h) {
  const fc = kw => h.findIndex(x => kw.every(k => x.includes(k)));
  return {
    modello          : fc(["MODELLO"]),
    telaio           : fc(["TELAIO"]),
    targa            : fc(["TARGA"]),
    dataFermo        : h.findIndex(x => x.includes("DATA") && x.includes("FERMO")),
    officina         : fc(["OFFICINA"]),
    motivo           : fc(["MOTIVO"]),
    aggiornamenti    : fc(["AGGIORNAMENTI"]),
    riferimento      : h.findIndex(x => x.includes("RIFERIMENTO") && !x.includes("SEDE")),
    dataAttesa       : h.findIndex(x => x.includes("DATA") && x.includes("ATTESA")),
    emailOff         : h.findIndex(x => x.includes("EMAIL") && x.includes("OFFICINA")),
    emailLeas        : h.findIndex(x => (x.includes("EMAIL") && x.includes("LEASING")) || (x.includes("EMAIL") && x.includes("ARVAL"))),
    dataInvio        : h.findIndex(x => x.includes("DATA") && x.includes("INVIO")),
    costoGiornaliero : h.findIndex(x => x.includes("COSTO") && x.includes("GIORNALIERO")),
    tel              : h.findIndex(x => x.includes("TEL") || x.includes("WHATSAPP")),
    sedeRiferimento  : h.findIndex(x => x.includes("SEDE") && x.includes("RIFERIMENTO"))
  };
}

function getIdentificativoVeicolo(datiRiga, col) {
  const targa  = col.targa  >= 0 ? safeStr(datiRiga[col.targa]).toUpperCase()  : "";
  const telaio = col.telaio >= 0 ? safeStr(datiRiga[col.telaio]).toUpperCase() : "";

  if (targa)  return { valore: targa,  etichetta: "TARGA",  targa, telaio };
  if (telaio) return { valore: telaio, etichetta: "TELAIO", targa, telaio };
  return { valore: "", etichetta: "IDENTIFICATIVO", targa: "", telaio: "" };
}

function trovaColonnaStato(intestazioni) {
  const i = intestazioni.findIndex(h => h.includes("STATO") && h.includes("PRATICA"));
  return i >= 0 ? i + 1 : 0;
}

function leggiIntestazioni(foglio) {
  const nCol = foglio.getLastColumn();
  if (nCol < 1) return [];
  const maxR   = Math.min(foglio.getLastRow(), 8);
  if (maxR < 1) return [];
  const prime8 = foglio.getRange(1, 1, maxR, nCol).getValues();
  for (let r = 0; r < prime8.length; r++) {
    const riga = prime8[r].map(v => v.toString().toUpperCase());
      if (riga.some(v => v.includes("TARGA") || v.includes("MODELLO") || v.includes("TELAIO"))) {
      return prime8[r].map(h => h.toString().toUpperCase().trim());
    }
  }
  return prime8[0].map(h => h.toString().toUpperCase().trim());
}

function trovaRigaHeader(foglio) {
  const nCol = foglio.getLastColumn();
  const maxR = Math.min(foglio.getLastRow(), 8);
  if (nCol < 1 || maxR < 1) return 1;
  const valori = foglio.getRange(1, 1, maxR, nCol).getValues();
  for (let r = 0; r < valori.length; r++) {
      if (valori[r].map(v => v.toString().toUpperCase()).some(v => v.includes("TARGA") || v.includes("MODELLO") || v.includes("TELAIO"))) {
      return r + 1;
    }
  }
  return 1;
}

function coloraCellaStato(cella, valore) {
  const v = valore.toString().toUpperCase();
  if (v.includes("CHIUSO")) {
    cella.setBackground("#ffebee").setFontColor("#c62828").setFontWeight("bold").setHorizontalAlignment("center");
  } else if (v.includes("APERTO")) {
    cella.setBackground("#e8f5e9").setFontColor("#2e7d32").setFontWeight("bold").setHorizontalAlignment("center");
  }
}

function applicaDropdownStato(range) {
  range.setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireValueInList(["🟢 APERTO", "🔴 CHIUSO"], true)
      .setAllowInvalid(false).build()
  );
}

function applicaDropdownSedeRiferimento(range) {
  range.setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireValueInList(["BN", "RM", "MI"], true)
      .setAllowInvalid(false).build()
  );
}

function toDate(val) {
  if (!val && val !== 0) return null;
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
  if (typeof val === "number") {
    if (val < 1000) return null;
    const ms = (val - 25569) * 86400000;
    const d  = new Date(ms);
    return (!isNaN(d.getTime()) && d.getFullYear() > 1980) ? d : null;
  }
  if (typeof val === "string" && val.trim() !== "") {
    const s = val.trim();
    const itMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (itMatch) {
      const d = new Date(itMatch[3], itMatch[2] - 1, itMatch[1]);
      return isNaN(d.getTime()) ? null : d;
    }
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function calcolaGiorni(data) {
  const d = toDate(data);
  if (!d) return 0;
  return Math.max(0, Math.floor((new Date() - d) / 86400000));
}

function urgenzaLivello(giorni) {
  const cfg = leggiConfig();
  if (giorni >= cfg.GIORNI_URGENTE_2) return 3;
  if (giorni >= cfg.GIORNI_URGENTE_1) return 2;
  return 1;
}

function calcolaFascia(giorni) {
  if (giorni === null || giorni === undefined) return "—";
  if (giorni <= 7)  return "✅ Rapida (≤7gg)";
  if (giorni <= 15) return "🟡 Breve (8-15gg)";
  if (giorni <= 30) return "🟠 Media (16-30gg)";
  if (giorni <= 60) return "🔴 Lunga (31-60gg)";
  return "⛔ Critica (>60gg)";
}

function fmtData(val) {
  if (!val && val !== 0) return "";
  const d = toDate(val);
  if (!d) return val ? val.toString() : "";
  try { return Utilities.formatDate(d, Session.getScriptTimeZone(), "dd/MM/yyyy"); }
  catch (_) { return val.toString(); }
}

function safeStr(v) { return (v !== null && v !== undefined) ? v.toString().trim() : ""; }

function normalizzaAggiornamentoSingolo(valore) {
  const raw = safeStr(valore).replace(/\r/g, "");
  if (!raw) return "";

  const rimuoviPrefissoStorico = s =>
    s.replace(/^\[\d{1,2}\/\d{1,2}\s+\d{1,2}:\d{2}\s*[·\-]\s*[^\]]+\]\s*/i, "").trim();

  const righe = raw
    .split("\n")
    .map(r => rimuoviPrefissoStorico(r))
    .filter(Boolean);

  if (righe.length === 0) return "";

  // Richiesta utente: mantenere solo il messaggio corrente, non lo storico.
  return righe[0];
}

function deveInviare(dataUltimoInvio) {
  const cfg = leggiConfig();
  if (!dataUltimoInvio || dataUltimoInvio === "") return true;
  return calcolaGiorni(dataUltimoInvio) >= cfg.GIORNI_PAUSA;
}

function estraiEmail(celle) {
  const res = [];
  celle.forEach(c => {
    if (c) c.toString().split(/[,;\s]+/).forEach(e => { if (e.includes("@")) res.push(e.trim()); });
  });
  return [...new Set(res)];
}

function scriviLog(errori) {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = leggiConfig();
  const log = ss.getSheetByName(cfg.FOGLIO_LOG) || ss.insertSheet(cfg.FOGLIO_LOG);
  log.getRange(log.getLastRow() + 1, 1, errori.length, 3).setValues(errori);
}

/* ----------------------------------------------------------------
   SEZIONE 16 — IMPORT MASSIVO VEICOLI
   ---------------------------------------------------------------- */

function getFogliDisponibili() {
  return getNomiFogliOperativi();
}

/* ----------------------------------------------------------------
   SEZIONE 17 — EMAIL REPORT FERMI → GENNARO
   ---------------------------------------------------------------- */

function raccogliFermiAperti() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const cfg   = leggiConfig();
  const fermi = [];

  getNomiFogliOperativi().forEach(nomeFoglio => {
    const f = ss.getSheetByName(nomeFoglio);
    if (!f || f.getLastRow() < 3) return;
    const sede = nomeFoglio.replace("FERMI TECNICI ", "");

    const rigaH        = trovaRigaHeader(f);
    const intestazioni = leggiIntestazioniCached(f);
    const col          = mappaColonne(intestazioni);
    const colStato     = trovaColonnaStato(intestazioni);

    const lastRow = f.getLastRow();
    if (lastRow <= rigaH) return;
    const dati = f.getRange(rigaH + 1, 1, lastRow - rigaH, f.getLastColumn()).getValues();

    dati.forEach((r, idx) => {
      const idv = getIdentificativoVeicolo(r, col);
      if (!idv.valore) return;

      const statoP = colStato > 0 ? safeStr(r[colStato - 1]).toUpperCase() : "";
      const statoA = col.aggiornamenti >= 0 ? safeStr(r[col.aggiornamenti]).toLowerCase() : "";
      const chiuso = statoP.includes("CHIUSO") || statoA.includes("chiuso") || statoA.includes("consegnata") || statoA.includes("ritirata");
      if (chiuso) return;

      const dataFermoRaw = col.dataFermo >= 0 ? r[col.dataFermo] : "";
      const dataFermo    = toDate(dataFermoRaw);
      const gg           = dataFermo ? calcolaGiorni(dataFermo) : 0;

      const dataAttesaRaw = col.dataAttesa >= 0 ? r[col.dataAttesa] : "";
      const dataAttesaFmt = dataAttesaRaw ? fmtData(dataAttesaRaw) : "—";

      const costoG  = col.costoGiornaliero >= 0 ? parseFloat(r[col.costoGiornaliero]) || 0 : 0;
      const costoSt = costoG > 0 && gg > 0 ? costoG * gg : 0;

      const urgenza = gg >= cfg.GIORNI_URGENTE_2 ? "critico"
                    : gg >= cfg.GIORNI_URGENTE_1  ? "urgente"
                    : "normale";

      fermi.push({
        sede,
        modello      : col.modello        >= 0 ? safeStr(r[col.modello])        : "",
        targa        : idv.valore,
        labelId      : idv.etichetta,
        _sheet       : nomeFoglio,
        _row         : rigaH + 1 + idx,
        gg,
        dataFermoFmt : dataFermo ? fmtData(dataFermoRaw) : "—",
        officina     : col.officina       >= 0 ? safeStr(r[col.officina])       : "",
        motivo       : col.motivo         >= 0 ? safeStr(r[col.motivo])         : "",
        aggiornamenti: col.aggiornamenti  >= 0 ? safeStr(r[col.aggiornamenti])  : "",
        dataAttesa   : dataAttesaFmt,
        costoG,
        costoSt,
        urgenza
      });
    });
  });

  fermi.sort((a, b) => {
    const ord = { critico: 0, urgente: 1, normale: 2 };
    if (ord[a.urgenza] !== ord[b.urgenza]) return ord[a.urgenza] - ord[b.urgenza];
    return b.gg - a.gg;
  });

  return fermi;
}

function trovaRigaFermoPerIdentificativo(foglio, col, rigaH, idTarget) {
  const id = safeStr(idTarget).toUpperCase();
  if (!id) return 0;
  const last = foglio.getLastRow();
  if (last <= rigaH) return 0;

  const dati = foglio.getRange(rigaH + 1, 1, last - rigaH, foglio.getLastColumn()).getValues();
  for (let i = 0; i < dati.length; i++) {
    const idv = getIdentificativoVeicolo(dati[i], col);
    if (safeStr(idv.valore).toUpperCase() === id) return rigaH + 1 + i;
  }
  return 0;
}

function aggiornaFermoPreview_(fermo) {
  if (!fermo) return { ok: false, msg: "Payload vuoto." };

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const nomeFoglio = safeStr(fermo._sheet || "");
  if (!nomeFoglio) return { ok: false, msg: "Foglio mancante nel payload." };

  const foglio = ss.getSheetByName(nomeFoglio);
  if (!foglio) return { ok: false, msg: "Foglio non trovato: " + nomeFoglio };

  const rigaH = trovaRigaHeader(foglio);
  const intestazioni = leggiIntestazioniCached(foglio);
  const col = mappaColonne(intestazioni);
  const idTarget = safeStr(fermo.targa).toUpperCase();

  let riga = parseInt(fermo._row, 10);
  if (!(riga > rigaH && riga <= foglio.getLastRow())) riga = 0;

  if (riga > 0 && idTarget) {
    const rowData = foglio.getRange(riga, 1, 1, foglio.getLastColumn()).getValues()[0];
    const idAttuale = safeStr(getIdentificativoVeicolo(rowData, col).valore).toUpperCase();
    if (idAttuale && idAttuale !== idTarget) riga = 0;
  }

  if (!riga && idTarget) {
    riga = trovaRigaFermoPerIdentificativo(foglio, col, rigaH, idTarget);
  }
  if (!riga) return { ok: false, msg: "Riga non trovata per identificativo " + (idTarget || "N/D") + "." };

  let aggiornato = false;

  if (col.aggiornamenti >= 0) {
    const cellaAgg = foglio.getRange(riga, col.aggiornamenti + 1);
    const oldAgg = safeStr(cellaAgg.getValue());
    const newAgg = normalizzaAggiornamentoSingolo(fermo.aggiornamenti);
    if (oldAgg !== newAgg) {
      cellaAgg.setValue(newAgg);
      const txt = newAgg.toLowerCase();
      if (txt.includes("attesa") || txt.includes("ricambi")) {
        cellaAgg.setFontColor("#e65100").setFontWeight("bold");
      } else if (txt.includes("pronto") || txt.includes("completat")) {
        cellaAgg.setFontColor("#2e7d32").setFontWeight("bold");
      } else {
        cellaAgg.setFontColor("#2d3748").setFontWeight("normal");
      }
      aggiornato = true;
    }
  }

  if (col.dataAttesa >= 0) {
    const cellaAtt = foglio.getRange(riga, col.dataAttesa + 1);
    const newAttRaw = safeStr(fermo.dataAttesa);
    const newAtt = newAttRaw === "—" ? "" : newAttRaw;
    const oldRaw = cellaAtt.getValue();
    const oldStr = safeStr(oldRaw);

    if (!newAtt) {
      if (oldStr !== "") {
        cellaAtt.setValue("");
        aggiornato = true;
      }
    } else {
      const newDate = toDate(newAtt);
      if (newDate) {
        const oldDate = toDate(oldRaw);
        const tz = Session.getScriptTimeZone();
        const oldFmt = oldDate ? Utilities.formatDate(oldDate, tz, "dd/MM/yyyy") : "";
        const newFmt = Utilities.formatDate(newDate, tz, "dd/MM/yyyy");
        if (oldFmt !== newFmt) {
          cellaAtt.setValue(newDate).setNumberFormat("dd/MM/yyyy");
          aggiornato = true;
        }
      } else if (oldStr !== newAtt) {
        cellaAtt.setValue(newAtt);
        aggiornato = true;
      }
    }
  }

  if (aggiornato) {
    aggiornaColoreRiga(foglio, riga, col, intestazioni);
    aggiornaSommarioFoglio(foglio, nomeFoglio);
  }

  return { ok: true, aggiornato, foglio: nomeFoglio, riga };
}

function aggiornaFermoDaPreview(fermoJson) {
  try {
    const fermo = JSON.parse(fermoJson || "{}");
    return aggiornaFermoPreview_(fermo);
  } catch (e) {
    scriviLog([[new Date(), "aggiornaFermoDaPreview", e.toString()]]);
    return { ok: false, msg: e.message };
  }
}

function salvaFermiDaPreview(fermiJson) {
  try {
    const arr = JSON.parse(fermiJson || "[]");
    if (!Array.isArray(arr)) return { ok: false, salvati: 0, errori: ["Payload non valido."] };

    let salvati = 0;
    const errori = [];
    arr.forEach(f => {
      const res = aggiornaFermoPreview_(f);
      if (!res.ok) {
        errori.push(res.msg || "Errore salvataggio.");
      } else if (res.aggiornato) {
        salvati++;
      }
    });

    return { ok: errori.length === 0, salvati, errori };
  } catch (e) {
    scriviLog([[new Date(), "salvaFermiDaPreview", e.toString()]]);
    return { ok: false, salvati: 0, errori: [e.message] };
  }
}

/* ----------------------------------------------------------------
   Fix buildEmailPreview globale
   ---------------------------------------------------------------- */

function buildDialogAnteprima(fermiArr, nFermi, emailDefault) {
  return '<!DOCTYPE html>\n' +
'<html lang="it"><head><meta charset="UTF-8">\n' +
'<style>\n' +
'*{box-sizing:border-box;margin:0;padding:0}\n' +
'html,body{height:100%;overflow:hidden;font-family:Arial,sans-serif;background:#0d1117;color:#e6edf3;font-size:12px}\n' +
'.shell{display:flex;flex-direction:column;height:100vh}\n' +
'.topbar{background:#161b22;border-bottom:1px solid #21262d;padding:9px 14px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;gap:10px}\n' +
'.panels{flex:1;display:flex;overflow:hidden}\n' +
'.tb-title{font-size:13px;font-weight:700}\n' +
'.tb-sub{font-size:10px;color:#8b949e;margin-top:1px}\n' +
'.tb-right{display:flex;align-items:center;gap:8px}\n' +
'.lbl{font-size:11px;color:#8b949e;white-space:nowrap}\n' +
'.inp-email{background:#0d1117;border:1px solid #30363d;border-radius:5px;color:#e6edf3;font-size:11px;padding:5px 9px;outline:none;width:210px}\n' +
'.btn{border-radius:5px;cursor:pointer;font-family:Arial,sans-serif;font-size:11px;font-weight:600;padding:7px 14px;border:none;white-space:nowrap}\n' +
'.btn-primary{background:#1a237e;color:#fff}\n' +
'.btn-primary:disabled{background:#21262d;color:#484f58;cursor:default}\n' +
'.btn-ghost{background:none;border:1px solid #30363d;color:#8b949e}\n' +
'.btn-green{background:#0d2818;border:1px solid #238636;color:#3fb950}\n' +
'.editor{width:340px;flex-shrink:0;border-right:1px solid #21262d;overflow-y:auto;display:flex;flex-direction:column}\n' +
'.editor-hdr{background:#161b22;border-bottom:1px solid #21262d;padding:8px 12px;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#8b949e;flex-shrink:0}\n' +
'.cards-list{padding:10px;display:flex;flex-direction:column;gap:10px;flex:1}\n' +
'.ecard{background:#161b22;border:1px solid #21262d;border-radius:7px;overflow:hidden}\n' +
'.ecard.excluded{opacity:.4}\n' +
'.ecard-hdr{padding:8px 12px;display:flex;align-items:center;gap:8px;cursor:pointer}\n' +
'.ecard-hdr:hover{background:#1c2128}\n' +
'.dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}\n' +
'.dot.critico{background:#e53935}.dot.urgente{background:#fb8c00}.dot.normale{background:#43a047}\n' +
'.ename{font-size:11px;font-weight:700;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\n' +
'.etarga{font-family:monospace;font-size:10px;color:#8b949e}\n' +
'.egg{font-size:10px;color:#8b949e;flex-shrink:0}\n' +
'.excl-btn{background:none;border:1px solid #30363d;border-radius:4px;color:#8b949e;cursor:pointer;font-size:9px;padding:2px 6px;flex-shrink:0}\n' +
'.excl-btn.on{border-color:#3fb950;color:#3fb950}\n' +
'.ebody{padding:0 12px 10px;display:flex;flex-direction:column;gap:7px}\n' +
'.flbl{font-size:9px;color:#8b949e;text-transform:uppercase;letter-spacing:.8px;margin-bottom:2px}\n' +
'textarea.finp,input.finp{background:#0d1117;border:1px solid #30363d;border-radius:5px;color:#e6edf3;font-family:Arial,sans-serif;font-size:11px;padding:6px 8px;outline:none;width:100%}\n' +
'textarea.finp{min-height:54px;resize:vertical}\n' +
'textarea.finp:focus,input.finp:focus{border-color:#58a6ff}\n' +
'.preview-panel{flex:1;display:flex;flex-direction:column;overflow:hidden}\n' +
'.prev-hdr{background:#161b22;border-bottom:1px solid #21262d;padding:6px 12px;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#8b949e;flex-shrink:0;display:flex;align-items:center;justify-content:space-between}\n' +
'.prev-frame{flex:1;border:none;width:100%;display:block;background:#fff}\n' +
'.loading{display:flex;align-items:center;justify-content:center;flex:1;color:#484f58;font-size:13px}\n' +
'.toast{position:fixed;bottom:14px;left:50%;transform:translateX(-50%);background:#122117;border:1px solid #3fb950;border-radius:7px;color:#3fb950;font-size:11px;padding:9px 18px;display:none;z-index:999;white-space:nowrap}\n' +
'.toast.err{background:#3d1515;border-color:#f85149;color:#f85149}\n' +
'</style></head>\n' +
'<body>\n' +
'<div class="shell">\n' +
'  <div class="topbar">\n' +
'    <div><div class="tb-title">📧 Componi Email per Gennaro</div><div class="tb-sub" id="tbSub">Caricamento dati...</div></div>\n' +
'    <div class="tb-right">\n' +
'      <span class="lbl">A:</span>\n' +
'      <input class="inp-email" id="emailDest" type="email" value="' + emailDefault + '">\n' +
'      <button class="btn btn-ghost" onclick="google.script.host.close()">Annulla</button>\n' +
'      <button class="btn btn-ghost" id="btnSync" onclick="aggiornaExcel()" disabled>💾 Aggiorna Excel</button>\n' +
'      <button class="btn btn-green" id="btnRefresh" onclick="aggiornaAnteprima()" disabled>🔄 Aggiorna anteprima</button>\n' +
'      <button class="btn btn-primary" id="btnSend" onclick="invia()" disabled>📨 Invia Email</button>\n' +
'    </div>\n' +
'  </div>\n' +
'  <div class="panels">\n' +
'    <div class="editor">\n' +
'      <div class="editor-hdr">✏️ Modifica veicoli</div>\n' +
'      <div class="cards-list" id="cardsList"><div class="loading">⏳ Caricamento fermi...</div></div>\n' +
'    </div>\n' +
'    <div class="preview-panel">\n' +
'      <div class="prev-hdr"><span>👁️ Anteprima email</span><span id="prevStatus" style="color:#484f58;font-weight:400;letter-spacing:0">Carica i dati poi premi Aggiorna</span></div>\n' +
'      <iframe class="prev-frame" id="prevFrame"></iframe>\n' +
'    </div>\n' +
'  </div>\n' +
'</div>\n' +
'<div class="toast" id="toast"></div>\n' +
'<script>\n' +
'var fermi = [];\n' +
'var saveTimers = {};\n' +
'var saveInCorso = 0;\n' +
'google.script.run\n' +
'  .withSuccessHandler(function(dati) {\n' +
'    fermi = dati.map(function(f) { return Object.assign({}, f, {includi: true}); });\n' +
'    buildCards();\n' +
'    document.getElementById("btnSync").disabled = false;\n' +
'    document.getElementById("btnRefresh").disabled = false;\n' +
'    aggiornaAnteprima();\n' +
'  })\n' +
'  .withFailureHandler(function(err) {\n' +
'    document.getElementById("cardsList").innerHTML = "<div style=\'color:#f85149;padding:16px\'>Errore caricamento: " + (err.message || err) + "</div>";\n' +
'  })\n' +
'  .raccogliFermiAperti();\n' +
'function buildCards() {\n' +
'  var list = document.getElementById("cardsList");\n' +
'  list.innerHTML = "";\n' +
'  fermi.forEach(function(f, i) {\n' +
'    var dotClass = f.urgenza === "critico" ? "critico" : f.urgenza === "urgente" ? "urgente" : "normale";\n' +
'    var card = document.createElement("div");\n' +
'    card.className = "ecard" + (f.includi ? "" : " excluded");\n' +
'    card.id = "card_" + i;\n' +
'    var inner = "<div class=\'ecard-hdr\' onclick=\'toggleCollapse(" + i + ")\'>"' +
'      + "<span class=\'dot " + dotClass + "\'></span>"' +
'      + "<span class=\'ename\'>" + esc(f.modello) + "</span>"' +
'      + "<span class=\'etarga\'>" + esc(f.targa) + "</span>"' +
'      + "<span class=\'egg\'>" + (f.gg||0) + " gg</span>"' +
'      + "<button class=\'excl-btn" + (f.includi ? "" : " on") + "\' onclick=\'event.stopPropagation();toggleIncludi(" + i + ")\'>" + (f.includi ? "✕ Escludi" : "✓ Includi") + "</button>"' +
'      + "</div>";\n' +
'    inner += "<div class=\'ebody\' id=\'body_" + i + "\'>"' +
'      + "<div><div class=\'flbl\'>Situazione attuale</div>"' +
'      + "<textarea class=\'finp\' id=\'agg_" + i + "\' rows=\'3\' oninput=\'queueSave(" + i + ")\' onchange=\'queueSave(" + i + ")\' >" + esc(f.aggiornamenti) + "</textarea></div>"' +
'      + "<div><div class=\'flbl\'>Data previsto rientro</div>"' +
'      + "<input class=\'finp\' id=\'att_" + i + "\' type=\'text\' value=\'" + esc(f.dataAttesa) + "\' oninput=\'queueSave(" + i + ")\' onchange=\'queueSave(" + i + ")\'></div>"' +
'      + "<div style=\'font-size:10px;color:#484f58;margin-top:4px\'>Sede: <span style=\'color:#8b949e\'>" + esc(f.sede) + "</span> · Officina: <span style=\'color:#8b949e\'>" + esc(f.officina||"—") + "</span> · Dal: <span style=\'color:#8b949e\'>" + esc(f.dataFermoFmt||"—") + "</span></div>"' +
'      + "</div>";\n' +
'    card.innerHTML = inner;\n' +
'    list.appendChild(card);\n' +
'  });\n' +
'  aggiornaContatore();\n' +
'}\n' +
'function sincronizzaDalDOM() {\n' +
'  fermi.forEach(function(f, i) {\n' +
'    var elAgg = document.getElementById("agg_" + i);\n' +
'    var elAtt = document.getElementById("att_" + i);\n' +
'    if (elAgg) f.aggiornamenti = elAgg.value;\n' +
'    if (elAtt) f.dataAttesa    = elAtt.value;\n' +
'  });\n' +
'}\n' +
'function sincronizzaRigaDalDOM(i) {\n' +
'  var f = fermi[i];\n' +
'  if (!f) return;\n' +
'  var elAgg = document.getElementById("agg_" + i);\n' +
'  var elAtt = document.getElementById("att_" + i);\n' +
'  if (elAgg) f.aggiornamenti = elAgg.value;\n' +
'  if (elAtt) f.dataAttesa    = elAtt.value;\n' +
'}\n' +
'function queueSave(i) {\n' +
'  sincronizzaRigaDalDOM(i);\n' +
'  if (saveTimers[i]) clearTimeout(saveTimers[i]);\n' +
'  var st = document.getElementById("prevStatus");\n' +
'  if (st) st.textContent = "Salvataggio modifiche nel foglio...";\n' +
'  saveTimers[i] = setTimeout(function(){ salvaRiga(i); }, 650);\n' +
'}\n' +
'function salvaRiga(i) {\n' +
'  var f = fermi[i];\n' +
'  if (!f) return;\n' +
'  saveInCorso++;\n' +
'  google.script.run\n' +
'    .withSuccessHandler(function(res) {\n' +
'      saveInCorso = Math.max(0, saveInCorso - 1);\n' +
'      if (res && res.ok) {\n' +
'        var st = document.getElementById("prevStatus");\n' +
'        if (st && saveInCorso === 0) st.textContent = "Modifiche salvate nel foglio alle " + new Date().toLocaleTimeString("it-IT");\n' +
'      }\n' +
'    })\n' +
'    .withFailureHandler(function(err) {\n' +
'      saveInCorso = Math.max(0, saveInCorso - 1);\n' +
'      showToast("Errore salvataggio foglio: " + (err.message||err), true);\n' +
'      var st = document.getElementById("prevStatus");\n' +
'      if (st) st.textContent = "Errore salvataggio foglio";\n' +
'    })\n' +
'    .aggiornaFermoDaPreview(JSON.stringify(f));\n' +
'}\n' +
'function salvaTuttoPrimaDiInvio(cbOk, cbKo) {\n' +
'  sincronizzaDalDOM();\n' +
'  google.script.run\n' +
'    .withSuccessHandler(function(res) {\n' +
'      if (res && res.ok === false) {\n' +
'        if (cbKo) cbKo((res.errori && res.errori[0]) || "Errore salvataggio prima dell\'invio.");\n' +
'        return;\n' +
'      }\n' +
'      if (cbOk) cbOk();\n' +
'    })\n' +
'    .withFailureHandler(function(err) {\n' +
'      if (cbKo) cbKo(err.message || err);\n' +
'    })\n' +
'    .salvaFermiDaPreview(JSON.stringify(fermi));\n' +
'}\n' +
'function aggiornaExcel() {\n' +
'  var btn = document.getElementById("btnSync");\n' +
'  if (btn) { btn.disabled = true; btn.textContent = "Salvo..."; }\n' +
'  salvaTuttoPrimaDiInvio(function(){\n' +
'    var st = document.getElementById("prevStatus");\n' +
'    if (st) st.textContent = "Excel aggiornato alle " + new Date().toLocaleTimeString("it-IT");\n' +
'    showToast("✅ Excel aggiornato", false);\n' +
'    if (btn) { btn.disabled = false; btn.textContent = "💾 Aggiorna Excel"; }\n' +
'  }, function(errMsg){\n' +
'    showToast("Errore salvataggio: " + errMsg, true);\n' +
'    if (btn) { btn.disabled = false; btn.textContent = "💾 Aggiorna Excel"; }\n' +
'  });\n' +
'}\n' +
'function esc(s) {\n' +
'  return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/\'/g,"&#39;");\n' +
'}\n' +
'function toggleIncludi(i) {\n' +
'  fermi[i].includi = !fermi[i].includi;\n' +
'  var card = document.getElementById("card_" + i);\n' +
'  card.className = "ecard" + (fermi[i].includi ? "" : " excluded");\n' +
'  var btn = card.querySelector(".excl-btn");\n' +
'  btn.className = "excl-btn" + (fermi[i].includi ? "" : " on");\n' +
'  btn.innerHTML = fermi[i].includi ? "✕ Escludi" : "✓ Includi";\n' +
'  aggiornaContatore();\n' +
'}\n' +
'function toggleCollapse(i) {\n' +
'  var body = document.getElementById("body_" + i);\n' +
'  body.style.display = body.style.display === "none" ? "" : "none";\n' +
'}\n' +
'function aggiornaContatore() {\n' +
'  var nInc = fermi.filter(function(f){ return f.includi; }).length;\n' +
'  document.getElementById("tbSub").textContent = nInc + " fermi inclusi nell\'email";\n' +
'  document.getElementById("btnSend").disabled = nInc === 0;\n' +
'}\n' +
'function aggiornaAnteprima() {\n' +
'  sincronizzaDalDOM();\n' +
'  var btn = document.getElementById("btnRefresh");\n' +
'  btn.disabled = true; btn.textContent = "Generando...";\n' +
'  document.getElementById("prevStatus").textContent = "Generazione in corso...";\n' +
'  var attivi = fermi.filter(function(f){ return f.includi; });\n' +
'  google.script.run\n' +
'    .withSuccessHandler(function(html) {\n' +
'      document.getElementById("prevFrame").srcdoc = html;\n' +
'      document.getElementById("prevStatus").textContent = "Aggiornata alle " + new Date().toLocaleTimeString("it-IT");\n' +
'      btn.disabled = false; btn.innerHTML = "🔄 Aggiorna anteprima";\n' +
'    })\n' +
'    .withFailureHandler(function(err) {\n' +
'      document.getElementById("prevStatus").textContent = "Errore: " + (err.message||err);\n' +
'      btn.disabled = false; btn.innerHTML = "🔄 Aggiorna anteprima";\n' +
'    })\n' +
'    .buildEmailPreview(JSON.stringify(attivi));\n' +
'}\n' +
'function invia() {\n' +
'  sincronizzaDalDOM();\n' +
'  var dest = document.getElementById("emailDest").value.trim();\n' +
'  if (!dest || dest.indexOf("@") < 0) { showToast("Inserisci un indirizzo email valido", true); return; }\n' +
'  var attivi = fermi.filter(function(f){ return f.includi; });\n' +
'  if (attivi.length === 0) { showToast("Nessun veicolo incluso", true); return; }\n' +
'  var btn = document.getElementById("btnSend");\n' +
'  btn.disabled = true; btn.textContent = "Salvo dati...";\n' +
'  salvaTuttoPrimaDiInvio(function(){\n' +
'    btn.textContent = "Invio...";\n' +
'    google.script.run\n' +
'      .withSuccessHandler(function(msg) {\n' +
'        showToast(msg, msg.indexOf("Errore") >= 0);\n' +
'        btn.textContent = "Inviata!";\n' +
'        setTimeout(function(){ google.script.host.close(); }, 2500);\n' +
'      })\n' +
'      .withFailureHandler(function(err) {\n' +
'        showToast("Errore: " + (err.message||err), true);\n' +
'        btn.disabled = false; btn.textContent = "📨 Invia Email";\n' +
'      })\n' +
'      .inviaEmailGennaro(dest, JSON.stringify(attivi));\n' +
'  }, function(errMsg){\n' +
'    showToast("Errore salvataggio: " + errMsg, true);\n' +
'    btn.disabled = false; btn.textContent = "📨 Invia Email";\n' +
'  });\n' +
'}\n' +
'function showToast(msg, isErr) {\n' +
'  var t = document.getElementById("toast");\n' +
'  t.textContent = msg;\n' +
'  t.className = "toast" + (isErr ? " err" : "");\n' +
'  t.style.display = "block";\n' +
'  if (!isErr) setTimeout(function(){ t.style.display = "none"; }, 4000);\n' +
'}\n' +
'<\/script>\n' +
'</body></html>';
}

function buildEmailPreview(fermiJson) {
  try {
    const fermi = JSON.parse(fermiJson || "[]").filter(f => f.includi !== false);
    // Robustezza: non dipendere da una singola funzione globale.
    if (typeof buildEmailGennaro === "function") {
      return buildEmailGennaro(fermi);
    }

    const normalizza = v => safeStr(v).replace(/\s+/g, " ").trim();
    const lista = (fermi || []).map(f => ({
      sede: normalizza(f.sede || ""),
      modello: normalizza(f.modello || ""),
      targa: f.targa || "",
      giorni: (typeof f.giorni === "number" ? f.giorni : (typeof f.gg === "number" ? f.gg : 0)),
      dataFermo: normalizza(f.dataFermo || f.dataFermoFmt || "—"),
      dataAttesa: normalizza(f.dataAttesa || "—"),
      officina: normalizza(f.officina || "—"),
      aggiornamenti: normalizza(f.aggiornamenti || "—")
    }));

    if (typeof buildEmailReportGennaroHtml === "function") {
      return buildEmailReportGennaroHtml(lista, {
        headerTitle: "📧 Report Fermi Aperti — GRETA S.R.L.",
        introText: "Ciao,\nqui trovi la situazione aggiornata dei fermi aperti.",
        summaryLabel: "Totale pratiche aperte",
        footerNote: "Priorità suggerita: gestire prima le pratiche con più giorni di fermo.",
        signatureName: "Silvio",
        signatureRole: "Fleet Manager"
      });
    }

    return buildEmailCompatCardHtml(lista);
  } catch(e) {
    return "<body style='font-family:monospace;padding:20px;color:red'><b>ERRORE:</b><br>" + e.message + "<br><br>" + (e.stack||"") + "</body>";
  }
}

function buildEmailGennaro(fermi) {
  const normalizza = v => safeStr(v).replace(/\s+/g, " ").trim();
  const lista = (fermi || []).map(f => ({
    sede: normalizza(f.sede || ""),
    modello: normalizza(f.modello || ""),
    targa: f.targa || "",
    giorni: (typeof f.giorni === "number" ? f.giorni : (typeof f.gg === "number" ? f.gg : 0)),
    dataFermo: normalizza(f.dataFermo || f.dataFermoFmt || "—"),
    dataAttesa: normalizza(f.dataAttesa || "—"),
    officina: normalizza(f.officina || "—"),
    aggiornamenti: normalizza(f.aggiornamenti || "—")
  }));

  // Se disponibile il template avanzato del report email, riutilizzalo.
  if (typeof buildEmailReportGennaroHtml === "function") {
    return buildEmailReportGennaroHtml(lista, {
      headerTitle: "📧 Report Fermi Aperti — GRETA S.R.L.",
      introText: "Ciao,\nqui trovi la situazione aggiornata dei fermi aperti.",
      summaryLabel: "Totale pratiche aperte",
      footerNote: "Priorità suggerita: gestire prima le pratiche con più giorni di fermo.",
      signatureName: "Silvio",
      signatureRole: "Fleet Manager"
    });
  }

  // Fallback minimale (non lascia mai la preview vuota).
  return buildEmailCompatCardHtml(lista);
}

function buildEmailCompatCardHtml(lista) {
  const esc = s => safeStr(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const badgeColor = g => g >= 15 ? "#c62828" : (g >= 7 ? "#ef6c00" : "#2e7d32");
  const cards = (lista || []).map(f => `
    <div style="border:1px solid #e6ebf0;border-radius:10px;padding:12px 12px 10px;margin-bottom:10px;background:#ffffff;">
      <div style="font-size:14px;font-weight:700;color:#1f2937;line-height:1.35;margin-bottom:6px;white-space:normal;word-break:normal;overflow-wrap:break-word;">
        ${esc(f.modello || "—")} <span style="font-family:Courier New,monospace;color:#0f172a;white-space:nowrap;">(${esc(f.targa || "—")})</span>
      </div>
      <div style="font-size:12px;color:#455a64;line-height:1.5;white-space:normal;word-break:normal;overflow-wrap:break-word;">
        <div><b>Sede:</b> ${esc(f.sede || "—")} &nbsp;|&nbsp; <b>Officina:</b> ${esc(f.officina || "—")}</div>
        <div><b>Data fermo:</b> ${esc(f.dataFermo || "—")} &nbsp;|&nbsp; <b>Attesa:</b> ${esc(f.dataAttesa || "—")}</div>
        <div><b>Giorni:</b> <span style="font-weight:700;color:${badgeColor(Number(f.giorni||0))};white-space:nowrap;">${Number(f.giorni||0)} gg</span></div>
      </div>
      <div style="margin-top:7px;padding-top:7px;border-top:1px dashed #edf1f4;font-size:12px;color:#4b5563;line-height:1.45;white-space:normal;word-break:normal;overflow-wrap:break-word;">
        <b>Aggiornamenti:</b> ${esc(f.aggiornamenti || "—")}
      </div>
    </div>
  `).join("");

  return `<!DOCTYPE html><html><body style="margin:0;background:#f4f6f8;font-family:Arial,sans-serif;color:#263238;">
    <div style="max-width:760px;width:100%;margin:0 auto;padding:16px;">
      <div style="background:#1a237e;color:#fff;padding:14px 16px;border-radius:10px 10px 0 0;">
        <h3 style="margin:0;font-size:18px;line-height:1.3;">📧 Report Fermi Aperti — GRETA S.R.L.</h3>
      </div>
      <div style="background:#fff;border:1px solid #e3e7eb;border-top:none;border-radius:0 0 10px 10px;padding:14px;">
        <p style="margin:0 0 10px;font-size:13px;line-height:1.45;">Totale pratiche aperte: <b>${(lista || []).length}</b></p>
        ${cards || `<div style="padding:12px;text-align:center;color:#78909c;border:1px dashed #dde3ea;border-radius:8px;">Nessuna pratica aperta</div>`}
      </div>
    </div>
  </body></html>`;
}

/* ----------------------------------------------------------------
   SEZIONE 18 — DASHBOARD COSTI
   ---------------------------------------------------------------- */

function raccogliDatiGrafici(arch) {
  const vuoto = { perMese: [], perSede: [], perFascia: [] };
  if (!arch || arch.getLastRow() < 5) return vuoto;

  const nRighe = arch.getLastRow() - 4;
  let dati     = arch.getRange(5, 1, nRighe, ARCH_COLS.length).getValues();

  const iTipo   = ARCH_COLS.indexOf("TIPO FERMO");
  const iData   = ARCH_COLS.indexOf("DATA DEL FERMO");
  const iChius2 = ARCH_COLS.indexOf("DATA CHIUSURA");
  const iSede   = ARCH_COLS.indexOf("SEDE");
  const iGiorni = ARCH_COLS.indexOf("TOT. GIORNI FERMO");
  const iCostoT = ARCH_COLS.indexOf("COSTO TOTALE (€)");
  const iCostoG = ARCH_COLS.indexOf("COSTO GIORNALIERO (€/gg)");
  const iFascia = ARCH_COLS.indexOf("FASCIA DURATA");
  const iTarga  = ARCH_COLS.indexOf("TARGA");

  dati = dati.filter(r => safeStr(r[iTipo]).toUpperCase() !== "COPART");

  const perMese   = {};
  const perSede   = {};
  const perFascia = {};
  const tz = Session.getScriptTimeZone();

  dati.forEach(r => {
    if (!r[iTarga]) return;

    const sede   = safeStr(r[iSede]).toUpperCase().trim() || "N/D";
    const gg     = parseFloat(r[iGiorni]) || 0;
    const cgG    = parseFloat(r[iCostoG]) || 0;
    const costoR = parseFloat(r[iCostoT]) || 0;
    const costo  = (cgG > 0 && gg > 0) ? cgG * gg : costoR;
    const fascia = safeStr(r[iFascia]).replace(/[✅🟡🟠🔴⛔]/g, "").trim() || "—";

    const dApert = toDate(r[iData]);
    if (dApert) {
      const chiave = Utilities.formatDate(dApert, tz, "MM/yyyy");
      if (!perMese[chiave]) perMese[chiave] = { mese: chiave, pratiche: 0, aperture: 0, costoTot: 0, _gg: [] };
      perMese[chiave].aperture++;
    }

    const dChius = toDate(r[iChius2]);
    if (dChius) {
      const chiave = Utilities.formatDate(dChius, tz, "MM/yyyy");
      if (!perMese[chiave]) perMese[chiave] = { mese: chiave, pratiche: 0, aperture: 0, costoTot: 0, _gg: [] };
      perMese[chiave].pratiche++;
      perMese[chiave].costoTot += costo;
      if (gg > 0) perMese[chiave]._gg.push(gg);
    }

    if (!perSede[sede]) perSede[sede] = { sede, pratiche: 0, costoTot: 0, _gg: [] };
    perSede[sede].pratiche++;
    perSede[sede].costoTot += costo;
    if (gg > 0) perSede[sede]._gg.push(gg);

    if (!perFascia[fascia]) perFascia[fascia] = { fascia, count: 0 };
    perFascia[fascia].count++;
  });

  const finalizzaGruppo = obj => {
    obj.giorniMedi = obj._gg.length
      ? Math.round(obj._gg.reduce((a, b) => a + b, 0) / obj._gg.length)
      : 0;
    obj.costoTot = Math.round(obj.costoTot);
    delete obj._gg;
  };

  Object.values(perMese).forEach(finalizzaGruppo);
  Object.values(perSede).forEach(finalizzaGruppo);

  const meseOrdinati = Object.values(perMese).sort((a, b) => {
    const [ma, ya] = a.mese.split("/");
    const [mb, yb] = b.mese.split("/");
    return new Date(+ya, +ma - 1) - new Date(+yb, +mb - 1);
  });

  const ordineFascia = ["Rapida (≤7gg)", "Breve (8-15gg)", "Media (16-30gg)", "Lunga (31-60gg)", "Critica (>60gg)", "—"];
  const fasciaOrdinata = Object.values(perFascia).sort((a, b) => {
    const ia = ordineFascia.findIndex(f => a.fascia.includes(f.split(" ")[0]));
    const ib = ordineFascia.findIndex(f => b.fascia.includes(f.split(" ")[0]));
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });

  return {
    perMese   : meseOrdinati,
    perSede   : Object.values(perSede),
    perFascia : fasciaOrdinata
  };
}

/* ----------------------------------------------------------------
   Costruisce il documento HTML con i 4 grafici Recharts.
   ---------------------------------------------------------------- */
function buildDashboardRechartsHtml(fermi, dati) {
  const cfg  = leggiConfig();
  const ora  = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm");

  const nCrit      = fermi.filter(f => f.urgenza === "critico").length;
  const nUrg       = fermi.filter(f => f.urgenza === "urgente").length;
  const nNorm      = fermi.filter(f => f.urgenza === "normale").length;
  const totArch    = dati.perMese.reduce((a, m) => a + m.pratiche, 0);
  const costoArch  = dati.perSede.reduce((a, s) => a + s.costoTot, 0);
  const mediaGg    = dati.perSede.length
    ? Math.round(dati.perSede.reduce((a,s)=>a+s.giorniMedi*s.pratiche,0)/Math.max(1,dati.perSede.reduce((a,s)=>a+s.pratiche,0)))
    : 0;

  const urgRatio = fermi.length > 0
    ? { c: nCrit/fermi.length, u: nUrg/fermi.length, n: nNorm/fermi.length }
    : { c: 0.19, u: 0.28, n: 0.53 };

  const sedeEnrich = dati.perSede.map(s => ({
    ...s,
    critici : Math.max(1, Math.round(s.pratiche * urgRatio.c)),
    urgenti : Math.max(1, Math.round(s.pratiche * urgRatio.u)),
    normali : Math.max(0, s.pratiche - Math.round(s.pratiche*urgRatio.c) - Math.round(s.pratiche*urgRatio.u)),
    costoMedio: s.pratiche > 0 ? Math.round(s.costoTot / s.pratiche) : 0
  }));

  const mesiLabel  = dati.perMese.map(m => m.mese);
  const chiusiMese = dati.perMese.map(m => m.pratiche);
  const costiMese  = dati.perMese.map(m => m.costoTot);
  const ggMese     = dati.perMese.map(m => m.giorniMedi);

  const jSede    = JSON.stringify(sedeEnrich);
  const jFascia  = JSON.stringify(dati.perFascia);
  const jMesi    = JSON.stringify(mesiLabel);
  const apertureMese = dati.perMese.map(m => m.aperture || 0);
const jChiusi   = JSON.stringify(chiusiMese);
const jAperture = JSON.stringify(apertureMese);
const jCosti    = JSON.stringify(costiMese);
  const jGgMese  = JSON.stringify(ggMese);
  const jUrg     = JSON.stringify([nCrit, nUrg, nNorm]);

  const fmtEuroK = v => {
    const n = Math.round(v);
    return n >= 1000 ? "€" + Math.round(n/1000) + "k" : "€" + n;
  };

  return `<!DOCTYPE html>
<html lang="it"><head><meta charset="UTF-8">
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js"><\/script>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,sans-serif;background:#0d1117;color:#e6edf3;font-size:13px;height:100vh;display:flex;flex-direction:column;overflow:hidden}
.hdr{background:linear-gradient(120deg,#1a237e,#3949ab);padding:10px 20px;display:flex;justify-content:space-between;align-items:center;flex-shrink:0}
.hdr-t{font-size:14px;font-weight:700;letter-spacing:.8px}
.hdr-s{font-size:10px;color:rgba(255,255,255,.4);margin-top:2px}
.hdr-o{font-size:10px;color:rgba(255,255,255,.3);font-family:monospace}
.kpi-bar{display:flex;background:#0d1117;border-bottom:1px solid #21262d;flex-shrink:0}
.kpi{flex:1;padding:10px 6px;text-align:center;border-right:1px solid #21262d}
.kpi:last-child{border-right:none}
.kv{font-size:22px;font-weight:700;font-family:monospace;line-height:1}
.kl{font-size:9px;letter-spacing:1.2px;text-transform:uppercase;color:#8b949e;margin-top:3px}
.tabs{display:flex;gap:0;background:#161b22;border-bottom:1px solid #21262d;flex-shrink:0}
.tab{padding:8px 18px;font-size:11px;font-weight:600;cursor:pointer;color:#8b949e;border:none;background:none;border-bottom:2px solid transparent;letter-spacing:.5px;text-transform:uppercase}
.tab.on{color:#e6edf3;border-bottom-color:#3949ab}
.content{flex:1;overflow-y:auto;padding:14px;display:none}
.content.on{display:block}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.grid3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-bottom:12px}
.card{background:#161b22;border:1px solid #21262d;border-radius:8px;padding:14px}
.card.wide{grid-column:span 2}
.ctit{font-size:9px;letter-spacing:1.5px;text-transform:uppercase;color:#8b949e;margin-bottom:10px}
.sede-head{padding:10px 14px;font-size:12px;font-weight:700;letter-spacing:.8px;border-radius:7px 7px 0 0}
.sede-row{display:flex;justify-content:space-between;align-items:center;padding:7px 14px;border-top:1px solid #21262d;font-size:12px}
.sede-lbl{color:#8b949e}
.sede-val{font-weight:600}
.bar-bg{height:4px;background:#21262d;border-radius:2px;margin:8px 14px 12px}
.bar-fg{height:4px;border-radius:2px;transition:width .8s}
.leg{display:flex;flex-wrap:wrap;gap:12px;margin-bottom:8px;font-size:11px;color:#8b949e}
.legitem{display:flex;align-items:center;gap:5px}
.legdot{width:10px;height:10px;border-radius:2px;flex-shrink:0}
.footer{padding:7px 16px;display:flex;justify-content:space-between;align-items:center;border-top:1px solid #21262d;background:#0d1117;flex-shrink:0}
.ftxt{font-size:10px;color:#484f58}
.btn-c{background:#21262d;color:#e6edf3;border:1px solid #30363d;padding:5px 18px;border-radius:6px;cursor:pointer;font-size:11px}
.btn-c:hover{background:#30363d}
</style>
</head><body>

<div class="hdr">
  <div>
    <div class="hdr-t">📈 GRETA S.R.L. — Dashboard Costi & Fermi</div>
    <div class="hdr-s">Dati archivio storico · Chart.js</div>
  </div>
  <div class="hdr-o">${ora}</div>
</div>

<div class="kpi-bar">
  <div class="kpi"><div class="kv" style="color:#58a6ff">${fermi.length}</div><div class="kl">Aperti</div></div>
  <div class="kpi"><div class="kv" style="color:#f85149">${nCrit}</div><div class="kl">Critici</div></div>
  <div class="kpi"><div class="kv" style="color:#ffa657">${nUrg}</div><div class="kl">Urgenti</div></div>
  <div class="kpi"><div class="kv" style="color:#3fb950">${nNorm}</div><div class="kl">Normali</div></div>
  <div class="kpi"><div class="kv" style="color:#c6a0f6">${totArch}</div><div class="kl">Archiviati</div></div>
  <div class="kpi"><div class="kv" style="color:#79c0ff">${fmtEuroK(costoArch)}</div><div class="kl">Costo arch.</div></div>
  <div class="kpi"><div class="kv" style="color:#ffa657">${mediaGg} gg</div><div class="kl">Gg medi</div></div>
</div>

<div class="tabs">
  <button class="tab on"  onclick="showTab(0)">Panoramica</button>
  <button class="tab"     onclick="showTab(1)">Per sede</button>
  <button class="tab"     onclick="showTab(2)">Andamento</button>
</div>

<div class="content on" id="t0">
  <div class="grid2">
    <div class="card wide">
      <div class="ctit">Costo stimato per sede — suddiviso per urgenza (€)</div>
      <div class="leg" id="leg0"></div>
      <div style="position:relative;height:200px"><canvas id="c0"></canvas></div>
    </div>
    <div class="card">
      <div class="ctit">Distribuzione per fascia durata</div>
      <div class="leg" id="leg1"></div>
      <div style="position:relative;height:190px"><canvas id="c1"></canvas></div>
    </div>
    <div class="card">
      <div class="ctit">Stato urgenza fermi aperti</div>
      <div class="leg" id="leg2"></div>
      <div style="position:relative;height:190px"><canvas id="c2"></canvas></div>
    </div>
  </div>
</div>

<div class="content" id="t1">
  <div class="grid3" id="sedeCards"></div>
  <div class="card">
    <div class="ctit">Confronto sede — pratiche · giorni medi · costo medio/veicolo (€÷100)</div>
    <div class="leg">
      <span class="legitem"><span class="legdot" style="background:#3949ab"></span>Pratiche</span>
      <span class="legitem"><span class="legdot" style="background:#854F0B"></span>Giorni medi</span>
      <span class="legitem"><span class="legdot" style="background:#993556"></span>Costo medio ÷100€</span>
    </div>
    <div style="position:relative;height:200px"><canvas id="c3"></canvas></div>
  </div>
</div>

<div class="content" id="t2">
  <div class="card" style="margin-bottom:12px">
    <div class="ctit">Fermi chiusi mensili e costo totale archiviato (€)</div>
    <div class="leg">
      <span class="legitem"><span class="legdot" style="background:#3949ab"></span>Fermi chiusi</span>
      <span class="legitem"><span class="legdot" style="background:#854F0B"></span>Costo (÷100€)</span>
    </div>
    <div style="position:relative;height:200px"><canvas id="c4"></canvas></div>
  </div>
  <div class="card">
    <div class="ctit">Giorni medi fermo per mese</div>
    <div class="leg">
      <span class="legitem"><span class="legdot" style="background:#3949ab"></span>Media globale</span>
    </div>
    <div style="position:relative;height:180px"><canvas id="c5"></canvas></div>
  </div>
</div>

<div class="footer">
  <span class="ftxt">GRETA Fleet Manager — ${ora}</span>
  <button class="btn-c" onclick="google.script.host.close()">✕ Chiudi</button>
</div>

<script>
const SEDE_DATA  = ${jSede};
const FASCIA_DATA= ${jFascia};
const MESI       = ${jMesi};
const CHIUSI     = ${jChiusi};
const APERTURE   = ${jAperture};
const COSTI      = ${jCosti};
const GG_MESE    = ${jGgMese};
const URG_VALS   = ${jUrg};

const CM="#3949ab", CR="#993556", CB="#3B6D11";
const RED="#A32D2D", AMB="#854F0B";
const TT={backgroundColor:"#1c2128",titleColor:"#c6cdd5",bodyColor:"#8b949e",borderColor:"#30363d",borderWidth:1,padding:10,cornerRadius:6,displayColors:true};
const TICK={color:"#8b949e",font:{size:10}};
const GRID={color:"rgba(48,54,61,0.6)"};

function fmtE(v){return "€ "+Math.round(v).toLocaleString("it-IT")}
function mkLeg(id,items){
  const el=document.getElementById(id);
  if(!el) return;
  el.innerHTML=items.map(([c,l])=>\`<span class="legitem"><span class="legdot" style="background:\${c}"></span>\${l}</span>\`).join("");
}

function showTab(i){
  document.querySelectorAll(".tab").forEach((t,j)=>t.classList.toggle("on",j===i));
  document.querySelectorAll(".content").forEach((p,j)=>p.classList.toggle("on",j===i));
}

const fasciaColori=["#3B6D11","#639922","#BA7517","#A32D2D","#501313"];
mkLeg("leg0",[[RED,"Critici"],[AMB,"Urgenti"],[CB,"Normali"]]);
new Chart(document.getElementById("c0"),{
  type:"bar",
  data:{
    labels: SEDE_DATA.map(s=>s.sede),
    datasets:[
      {label:"Critici", data:SEDE_DATA.map(s=>s.critici*(s.costoMedio||0)), backgroundColor:RED,  borderRadius:3,stack:"s"},
      {label:"Urgenti", data:SEDE_DATA.map(s=>s.urgenti*(s.costoMedio||0)), backgroundColor:AMB,  borderRadius:3,stack:"s"},
      {label:"Normali", data:SEDE_DATA.map(s=>s.normali*(s.costoMedio||0)), backgroundColor:CB,   borderRadius:3,stack:"s"}
    ]
  },
  options:{
    responsive:true,maintainAspectRatio:false,
    plugins:{legend:{display:false},tooltip:{...TT,callbacks:{label:c=>c.dataset.label+": "+fmtE(c.raw)}}},
    scales:{x:{ticks:TICK,grid:GRID},y:{ticks:{...TICK,callback:v=>"€"+Math.round(v/1000)+"k"},grid:GRID,stacked:true}}
  }
});

const fLabels=FASCIA_DATA.map(f=>f.fascia);
const fVals=FASCIA_DATA.map(f=>f.count);
const fColors=fasciaColori.slice(0,fLabels.length);
mkLeg("leg1",fLabels.map((l,i)=>[fColors[i],l+" ("+fVals[i]+")"]));
new Chart(document.getElementById("c1"),{
  type:"doughnut",
  data:{labels:fLabels,datasets:[{data:fVals,backgroundColor:fColors,borderWidth:2,borderColor:"#161b22",hoverOffset:4}]},
  options:{responsive:true,maintainAspectRatio:false,cutout:"58%",
    plugins:{legend:{display:false},tooltip:{...TT,callbacks:{label:c=>c.label+": "+c.raw+" ("+Math.round(c.raw/fVals.reduce((a,b)=>a+b,0)*100)+"%)"}}}
  }
});

const urgLabels=["Normale","Urgente","Critico"];
const urgColors=[CB,AMB,RED];
mkLeg("leg2",urgLabels.map((l,i)=>[urgColors[i],l+": "+URG_VALS[i]]));
new Chart(document.getElementById("c2"),{
  type:"doughnut",
  data:{labels:urgLabels,datasets:[{data:URG_VALS,backgroundColor:urgColors,borderWidth:2,borderColor:"#161b22",hoverOffset:4}]},
  options:{responsive:true,maintainAspectRatio:false,cutout:"58%",plugins:{legend:{display:false},tooltip:{...TT}}}
});

(function(){
  const container=document.getElementById("sedeCards");
  if(!container||!SEDE_DATA.length) return;
  const sedeStyle={
    MILANO:{color:CM,bg:"#0d1f3e",tc:"#85b7eb"},
    ROMA:  {color:CR,bg:"#2d0a18",tc:"#ed93b1"},
    BN:    {color:CB,bg:"#0a1f07",tc:"#97c459"},
    SGS:   {color:"#6a1b9a",bg:"#2a0f34",tc:"#d1a8e6"}
  };
  const maxCosto=Math.max(...SEDE_DATA.map(s=>s.costoTot));
  SEDE_DATA.forEach(s=>{
    const st=sedeStyle[s.sede]||{color:"#546e7a",bg:"#161b22",tc:"#8b949e"};
    const pct=Math.round(s.costoTot/Math.max(1,maxCosto)*100);
    container.innerHTML+=\`<div class="card" style="padding:0;overflow:hidden">
      <div class="sede-head" style="background:\${st.bg};color:\${st.tc}">\${s.sede}</div>
      <div class="sede-row"><span class="sede-lbl">Pratiche aperte</span><span class="sede-val">\${s.pratiche}</span></div>
      <div class="sede-row"><span class="sede-lbl">Critici / Urgenti</span><span class="sede-val"><span style="color:\${RED}">\${s.critici}</span> / <span style="color:\${AMB}">\${s.urgenti}</span></span></div>
      <div class="sede-row"><span class="sede-lbl">Giorni medi</span><span class="sede-val">\${s.giorniMedi} gg</span></div>
      <div class="sede-row"><span class="sede-lbl">Costo medio/veicolo</span><span class="sede-val">\${fmtE(s.costoMedio)}</span></div>
      <div class="sede-row" style="border-bottom:none"><span class="sede-lbl">Costo totale stimato</span><span class="sede-val" style="color:\${st.color};font-size:15px">\${fmtE(s.costoTot)}</span></div>
      <div class="bar-bg"><div class="bar-fg" style="width:\${pct}%;background:\${st.color}"></div></div>
    </div>\`;
  });
})();

new Chart(document.getElementById("c3"),{
  type:"bar",
  data:{
    labels:SEDE_DATA.map(s=>s.sede),
    datasets:[
      {label:"Pratiche",      data:SEDE_DATA.map(s=>s.pratiche),                    backgroundColor:CM,  borderRadius:4,barPercentage:.65},
      {label:"Giorni medi",   data:SEDE_DATA.map(s=>s.giorniMedi),                   backgroundColor:AMB, borderRadius:4,barPercentage:.65},
      {label:"Costo medio ÷100",data:SEDE_DATA.map(s=>Math.round(s.costoMedio/100)),backgroundColor:CR,  borderRadius:4,barPercentage:.65}
    ]
  },
  options:{
    responsive:true,maintainAspectRatio:false,
    plugins:{legend:{display:false},tooltip:{...TT,callbacks:{label:c=>{
      if(c.datasetIndex===0) return "Pratiche: "+c.raw;
      if(c.datasetIndex===1) return "Giorni medi: "+c.raw+" gg";
      return "Costo medio: "+fmtE(c.raw*100)+"/veicolo";
    }}}},
    scales:{x:{ticks:TICK,grid:GRID},y:{ticks:TICK,grid:GRID,beginAtZero:true}}
  }
});

new Chart(document.getElementById("c4"),{
  type:"line",
  data:{
    labels:MESI,
    datasets:[
      {
        label:"Aperture",
        data:APERTURE,
        borderColor:"#e53935",
        backgroundColor:"rgba(229,57,53,0.08)",
        fill:true,
        tension:.4,
        borderWidth:2.5,
        pointRadius:5,
        pointHoverRadius:8,
        pointBackgroundColor:"#e53935",
        pointBorderColor:"#1c2128",
        pointBorderWidth:2,
        order:2
      },
      {
        label:"Chiusure",
        data:CHIUSI,
        borderColor:"#43a047",
        backgroundColor:"rgba(67,160,71,0.08)",
        fill:true,
        tension:.4,
        borderWidth:2.5,
        pointRadius:5,
        pointHoverRadius:8,
        pointBackgroundColor:"#43a047",
        pointBorderColor:"#1c2128",
        pointBorderWidth:2,
        order:1
      }
    ]
  },
  options:{
    responsive:true,
    maintainAspectRatio:false,
    interaction:{mode:"index",intersect:false},
    plugins:{
      legend:{
        display:true,
        position:"top",
        align:"end",
        labels:{
          color:"#8b949e",
          font:{size:11},
          boxWidth:12,
          boxHeight:12,
          borderRadius:3,
          padding:16,
          usePointStyle:true,
          pointStyle:"circle"
        }
      },
      tooltip:{
        ...TT,
        callbacks:{
          title: items => items[0].label,
          label: c => {
            const delta = (CHIUSI[c.dataIndex]||0) - (APERTURE[c.dataIndex]||0);
            if(c.datasetIndex===0) return " Aperture: "+c.raw+" veicoli";
            return [
              " Chiusure: "+c.raw+" veicoli",
              " Bilancio: "+(delta>=0?"▲ +":"▼ ")+delta+" veicoli"
            ];
          }
        }
      }
    },
    scales:{
      x:{
        ticks:{...TICK,maxRotation:30},
        grid:{color:"rgba(48,54,61,0.3)"},
        border:{dash:[4,4]}
      },
      y:{
        ticks:{...TICK,stepSize:1,callback:v=>v+" v."},
        grid:{color:"rgba(48,54,61,0.3)"},
        border:{dash:[4,4]},
        min:0,
        title:{display:true,text:"N. veicoli",color:"#8b949e",font:{size:10}}
      }
    }
  }
});

new Chart(document.getElementById("c5"),{
  type:"line",
  data:{
    labels:MESI,
    datasets:[{
      label:"Gg medi",data:GG_MESE,
      borderColor:CM,backgroundColor:"rgba(57,73,171,0.08)",fill:true,
      tension:.35,pointRadius:3,pointBackgroundColor:CM
    }]
  },
  options:{
    responsive:true,maintainAspectRatio:false,
    plugins:{legend:{display:false},tooltip:{...TT,callbacks:{label:c=>c.raw+" gg"}}},
    scales:{
      x:{ticks:TICK,grid:GRID},
      y:{ticks:{...TICK,callback:v=>v+" gg"},grid:GRID,min:0}
    }
  }
});
<\/script>
</body></html>`;
}

/* ----------------------------------------------------------------
   BLOCCO COMPATIBILITA' FUNZIONI MENU (SELF-CONTAINED SINGLE FILE)
   ---------------------------------------------------------------- */

function apriDashboardKPI() {
  if (typeof generaModelloKPI === "function") {
    generaModelloKPI();
    return;
  }
  // Fallback: apri dashboard costi se KPI non presente nel file unico
  apriDashboardCosti();
}

function apriDashboardCosti() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = leggiConfig();
  const arch = ss.getSheetByName(cfg.FOGLIO_ARCHIVIO);
  if (!arch) {
    safeAlert("⚠️ Archivio non trovato", "Crea prima il foglio archivio per visualizzare la dashboard costi.");
    return;
  }
  const fermi = raccogliFermiAperti();
  const dati = raccogliDatiGrafici(arch);
  const html = buildDashboardRechartsHtml(fermi, dati);
  SpreadsheetApp.getUi().showModelessDialog(
    HtmlService.createHtmlOutput(html).setWidth(1500).setHeight(920),
    "📈 Dashboard Costi"
  );
}

function apriGraficoAndamento() {
  apriDashboardCosti();
}

function apriImportMassivo() {
  const html = HtmlService.createHtmlOutput(
    "<div style='font-family:Arial;padding:14px'>" +
    "<h3 style='margin:0 0 8px'>Import massivo</h3>" +
    "<p style='font-size:12px;color:#555'>Funzione predisposta. Usa il menu CSV del foglio o estendiamo qui il parser nel prossimo step.</p>" +
    "</div>"
  ).setWidth(560).setHeight(220);
  SpreadsheetApp.getUi().showModalDialog(html, "📥 Import Massivo Veicoli");
}

function apriEmailReportGennaro() {
  const cfg = leggiConfig();
  const fermi = raccogliFermiAperti();
  const html = buildDialogAnteprima(fermi, fermi.length, cfg.EMAIL_GENNARO || cfg.EMAIL_CAPO);
  SpreadsheetApp.getUi().showModalDialog(
    HtmlService.createHtmlOutput(html).setWidth(1400).setHeight(860),
    "📧 Email Report Fermi → Gennaro"
  );
}

function inviaEmailGennaro(destinatario, fermiJson) {
  try {
    const cfg = leggiConfig();
    const to = safeStr(destinatario) || cfg.EMAIL_GENNARO || cfg.EMAIL_CAPO;
    if (!to || to.indexOf("@") < 0) return "Errore: email destinatario non valida.";

    const fermi = JSON.parse(fermiJson || "[]").filter(f => f.includi !== false);
    const html = buildEmailPreview(JSON.stringify(fermi));
    const ora = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm");
    const subject = "📊 Report fermi aperti GRETA — " + fermi.length + " pratiche (" + ora + ")";

    MailApp.sendEmail({
      to,
      subject,
      htmlBody: html,
      name: cfg.NOME_MITTENTE,
      replyTo: cfg.EMAIL_CAPO
    });
    return "✅ Report inviato a " + to + ".";
  } catch (e) {
    scriviLog([[new Date(), "inviaEmailGennaro", e.toString()]]);
    return "Errore: " + e.message;
  }
}

function processaTuttiIFogli() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    safeAlert("⚠️ Attendi", "Altro processo in esecuzione. Riprova tra qualche secondo.");
    return;
  }
  try {
    const cfg = leggiConfig();
    const errori = [];
    const solleciti = [];

    getNomiFogliOperativi().forEach(nome => {
      const f = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(nome);
      if (!f || f.getLastRow() < 5) return;

      const intestazioni = leggiIntestazioniCached(f);
      const col = mappaColonne(intestazioni);
      const colStato = trovaColonnaStato(intestazioni) - 1;
      const dati = f.getDataRange().getValues();

      for (let i = 4; i < dati.length; i++) {
        const riga = dati[i];
        const idv = getIdentificativoVeicolo(riga, col);
        if (!idv.valore) continue;

        const statoP = colStato >= 0 ? safeStr(riga[colStato]).toUpperCase() : "";
        const statoA = col.aggiornamenti >= 0 ? safeStr(riga[col.aggiornamenti]).toLowerCase() : "";
        const chiuso = statoP.includes("CHIUSO") || statoA.includes("chiuso") || statoA.includes("consegnata") || statoA.includes("ritirata");
        if (chiuso) continue;

        if (!deveInviare(col.dataInvio >= 0 ? riga[col.dataInvio] : null)) continue;

        const email = estraiEmail([
          col.emailOff >= 0 ? riga[col.emailOff] : null,
          col.emailLeas >= 0 ? riga[col.emailLeas] : null
        ]);
        if (!email.length) continue;

        solleciti.push(buildSollecitoCompat(f, i + 1, col, riga, idv.valore, email));
      }
    });

    if (solleciti.length > 0) inviaEmailBatchCompat(solleciti, errori);
    if (errori.length > 0) scriviLog(errori);
    safeAlert("INVIO COMPLETATO", "Email inviate: " + solleciti.length);
  } finally {
    lock.releaseLock();
  }
}

function inviaSollecitoManuale() {
  const ui = SpreadsheetApp.getUi();
  const foglio = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const rigaIdx = foglio.getActiveCell().getRow();
  const rigaH = trovaRigaHeader(foglio);
  if (rigaIdx <= rigaH) { ui.alert("Seleziona una riga dati valida."); return; }

  const intestazioni = leggiIntestazioniCached(foglio);
  const col = mappaColonne(intestazioni);
  const dati = foglio.getRange(rigaIdx, 1, 1, foglio.getLastColumn()).getValues()[0];
  const idv = getIdentificativoVeicolo(dati, col);
  const email = estraiEmail([col.emailOff >= 0 ? dati[col.emailOff] : null, col.emailLeas >= 0 ? dati[col.emailLeas] : null]);
  if (!idv.valore || !email.length) { ui.alert("⚠️ Identificativo veicolo o email mancanti."); return; }

  const errori = [];
  inviaEmailBatchCompat([buildSollecitoCompat(foglio, rigaIdx, col, dati, idv.valore, email)], errori);
  ui.alert(errori.length ? ("⚠️ Errore: " + errori[0][2]) : "✅ Email inviata!");
}

function inviaWhatsAppManuale() {
  const ui = SpreadsheetApp.getUi();
  const foglio = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const rigaIdx = foglio.getActiveCell().getRow();
  const rigaH = trovaRigaHeader(foglio);
  if (rigaIdx <= rigaH) { ui.alert("Seleziona una riga dati valida."); return; }

  const intestazioni = leggiIntestazioniCached(foglio);
  const col = mappaColonne(intestazioni);
  const dati = foglio.getRange(rigaIdx, 1, 1, foglio.getLastColumn()).getValues()[0];
  const idv = getIdentificativoVeicolo(dati, col);
  if (!idv.valore) { ui.alert("Identificativo veicolo mancante."); return; }

  let tel = col.tel >= 0 && dati[col.tel] ? safeStr(dati[col.tel]).replace(/\D/g, "") : "";
  if (!tel) { ui.alert("Numero telefono mancante (colonna TEL/WHATSAPP)."); return; }
  if (tel.length === 10) tel = "39" + tel;

  const msg = "Buongiorno, richiediamo aggiornamento per il veicolo " + safeStr(dati[col.modello]) + " (" + idv.valore + "). Grazie.";
  const url = "https://wa.me/" + tel + "?text=" + encodeURIComponent(msg);
  ui.showModelessDialog(
    HtmlService.createHtmlOutput("<div style='font-family:Arial;padding:16px;text-align:center'><a href='" + url + "' target='_blank' style='background:#25D366;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:700'>📲 APRI WHATSAPP</a></div>").setWidth(320).setHeight(130),
    "WhatsApp — Greta"
  );
}

function buildSollecitoCompat(foglio, riga, col, datiRiga, idVeicolo, email) {
  const giorni = col.dataFermo >= 0 && datiRiga[col.dataFermo]
    ? calcolaGiorni(datiRiga[col.dataFermo])
    : (col.dataInvio >= 0 ? calcolaGiorni(datiRiga[col.dataInvio]) : 0);
  let dataAttesa = "";
  if (col.dataAttesa >= 0 && datiRiga[col.dataAttesa]) {
    dataAttesa = fmtData(datiRiga[col.dataAttesa]);
  }
  return {
    foglio, riga,
    colDataInvio: col.dataInvio >= 0 ? col.dataInvio + 1 : -1,
    modello: col.modello >= 0 ? safeStr(datiRiga[col.modello]) : "Veicolo",
    targa: idVeicolo,
    officina: col.officina >= 0 ? safeStr(datiRiga[col.officina]) : "Officina",
    riferimento: col.riferimento >= 0 ? safeStr(datiRiga[col.riferimento]) : "",
    dataAttesa, email, giorni
  };
}

function inviaEmailBatchCompat(lista, errori) {
  const cfg = leggiConfig();
  const oggi = new Date();
  lista.forEach(d => {
    try {
      const liv = urgenzaLivello(d.giorni);
      const subject = (liv > 1 ? "🚨 URGENTE — " : "") + "Stato riparazione: " + d.modello + " (" + d.targa + ")";
      const body = buildCorpoCompat(d, liv);
      MailApp.sendEmail({
        to: d.email.join(","),
        subject,
        htmlBody: body,
        name: cfg.NOME_MITTENTE,
        replyTo: cfg.EMAIL_CAPO,
        bcc: cfg.EMAIL_CAPO
      });
      if (d.colDataInvio > 0) d.foglio.getRange(d.riga, d.colDataInvio).setValue(oggi);
    } catch (err) {
      errori.push([oggi, d.targa, err.toString()]);
    }
  });
}

function buildCorpoCompat(d, liv) {
  const alert = liv > 1 ? "<p style='color:#c62828;font-weight:bold'>⚠️ Sollecito urgente (" + d.giorni + " giorni)</p>" : "";
  const rif = d.riferimento ? ("<p>Riferimento: <b>" + d.riferimento + "</b></p>") : "";
  return "<div style='font-family:Arial;max-width:640px'>" +
    "<h3 style='margin:0 0 10px;color:#1a237e'>GRETA S.R.L. — Sollecito Fermo Tecnico</h3>" +
    alert +
    "<p>Spett.le " + (d.officina || "Officina") + ",</p>" +
    rif +
    "<p>Richiediamo aggiornamento per il veicolo <b>" + d.modello + "</b> (" + d.targa + ") fermo da <b>" + d.giorni + " giorni</b>.</p>" +
    (d.dataAttesa ? ("<p>Data attesa prevista: <b>" + d.dataAttesa + "</b></p>") : "") +
    "<p>Cordiali saluti,<br><b>Silvio</b><br>Fleet Manager</p>" +
    "</div>";
}

function aggiungiColonnaSedeRiferimento() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const log = [];
  getNomiFogliOperativi().forEach(nome => {
    const f = ss.getSheetByName(nome);
    if (!f) { log.push("❌ " + nome + ": foglio non trovato"); return; }
    const rigaH = trovaRigaHeader(f);
    const int = leggiIntestazioniCached(f);
    let idx = int.findIndex(h => h.includes("SEDE") && h.includes("RIFERIMENTO"));
    if (idx < 0) {
      const col = f.getLastColumn() + 1;
      f.getRange(rigaH, col).setValue("SEDE DI RIFERIMENTO")
        .setBackground(getTemaFoglio(nome).bg).setFontColor("#fff")
        .setFontWeight("bold").setHorizontalAlignment("center");
      f.setColumnWidth(col, 130);
      idx = col - 1;
      invalidaCacheIntestazioni(nome);
      log.push("✅ " + nome + ": colonna aggiunta");
    } else {
      log.push("ℹ️ " + nome + ": già presente");
    }
    const last = f.getLastRow();
    if (last > rigaH) applicaDropdownSedeRiferimento(f.getRange(rigaH + 1, idx + 1, last - rigaH, 1));
  });
  safeAlert("SEDE DI RIFERIMENTO", log.join("\n"));
}

function applicaSpostamentiSedeRiferimentoManuale() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const log = [];
  let moved = 0;

  getNomiFogliOperativi().forEach(nome => {
    const f = ss.getSheetByName(nome);
    if (!f) {
      log.push("❌ " + nome + ": foglio non trovato");
      return;
    }

    let spostatiFoglio = 0;
    let rigaH = trovaRigaHeader(f);
    let last = f.getLastRow();

    for (let r = last; r > rigaH; r--) {
      const intest = leggiIntestazioni(f);
      const col = mappaColonne(intest);
      if (col.sedeRiferimento < 0) break;

      const sedeSel = safeStr(f.getRange(r, col.sedeRiferimento + 1).getValue()).toUpperCase().trim();
      const nomeTarget = MAPPA_SEDE_RIFERIMENTO[sedeSel];
      if (!nomeTarget || nomeTarget === nome) continue;

      spostaRigaPerSede(f, r, sedeSel, nome, intest, col);
      spostatiFoglio++;
      moved++;
    }

    log.push("✅ " + nome + ": spostate " + spostatiFoglio + " righe");
  });

  safeAlert("🚚 Spostamento sedi completato", "Totale righe spostate: " + moved + "\n" + log.join("\n"));
}

function sostituisciRiferimentoConSede() {
  aggiungiColonnaSedeRiferimento();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  getNomiFogliOperativi().forEach(nome => {
    const f = ss.getSheetByName(nome);
    if (!f) return;
    const rigaH = trovaRigaHeader(f);
    const int = leggiIntestazioniCached(f);
    const col = mappaColonne(int);
    if (col.riferimento < 0 || col.sedeRiferimento < 0) return;
    const last = f.getLastRow();
    if (last <= rigaH) return;
    const vals = f.getRange(rigaH + 1, 1, last - rigaH, f.getLastColumn()).getValues();
    vals.forEach((r, i) => {
      const v = safeStr(r[col.riferimento]).toUpperCase();
      const sede = v.includes("BN") ? "BN" : (v.includes("RM") || v.includes("ROMA") ? "RM" : (v.includes("MI") || v.includes("MILANO") ? "MI" : ""));
      if (sede) f.getRange(rigaH + 1 + i, col.sedeRiferimento + 1).setValue(sede);
    });
  });
  safeAlert("✅ Completato", "Migrazione riferimento → sede completata dove possibile.");
}
