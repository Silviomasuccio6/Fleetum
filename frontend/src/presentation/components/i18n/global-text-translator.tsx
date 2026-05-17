import { useEffect } from "react";
import {
  FLEETUM_LANGUAGE_EVENT,
  FleetumLanguage,
  getFleetumLanguage,
  placeholderTranslationsItEn,
  reverseTranslatePlaceholder,
  reverseTranslateText,
  translatePlaceholder,
  translateText,
  translationsItEn
} from "../../i18n/fleetum-language";

const textOriginals = new WeakMap<Text, string>();
const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "TEXTAREA", "NOSCRIPT", "CODE", "PRE"]);
const ATTRIBUTES = ["placeholder", "title", "aria-label"] as const;

function preserveSpacing(source: string, translated: string) {
  const prefix = source.match(/^\s*/)?.[0] ?? "";
  const suffix = source.match(/\s*$/)?.[0] ?? "";
  return `${prefix}${translated}${suffix}`;
}

function translateTextNode(node: Text, language: FleetumLanguage) {
  const parent = node.parentElement;
  if (!parent || SKIP_TAGS.has(parent.tagName)) return;

  const raw = node.textContent ?? "";
  const trimmed = raw.trim();
  if (!trimmed) return;

  if (!textOriginals.has(node)) {
    textOriginals.set(node, reverseTranslateText(trimmed));
  }

  const original = textOriginals.get(node) ?? trimmed;
  const next = language === "en" ? translateText(original, "en") : original;
  if (next !== trimmed) node.textContent = preserveSpacing(raw, next);
}

function translateElementAttributes(element: Element, language: FleetumLanguage) {
  for (const attr of ATTRIBUTES) {
    const current = element.getAttribute(attr);
    if (!current) continue;

    const dataAttr = `data-fleetum-original-${attr}`;
    if (!element.hasAttribute(dataAttr)) {
      const original = attr === "placeholder" ? reverseTranslatePlaceholder(current) : reverseTranslateText(current);
      element.setAttribute(dataAttr, original);
    }

    const original = element.getAttribute(dataAttr) ?? current;
    const next = language === "en"
      ? attr === "placeholder"
        ? translatePlaceholder(original, "en")
        : translateText(original, "en")
      : original;

    if (next !== current) element.setAttribute(attr, next);
  }
}

function applyTranslations(root: ParentNode, language: FleetumLanguage) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    translateTextNode(node as Text, language);
    node = walker.nextNode();
  }

  if (root instanceof Element) translateElementAttributes(root, language);
  root.querySelectorAll?.("input, textarea, [title], [aria-label]").forEach((element) => translateElementAttributes(element, language));
}

export function GlobalTextTranslator() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const canTranslate = Object.keys(translationsItEn).length > 0 || Object.keys(placeholderTranslationsItEn).length > 0;
    if (!canTranslate) return;

    const run = () => window.requestAnimationFrame(() => applyTranslations(document.body, getFleetumLanguage()));
    const onLanguageChange = () => run();

    run();
    window.addEventListener(FLEETUM_LANGUAGE_EVENT, onLanguageChange);

    const observer = new MutationObserver((mutations) => {
      const language = getFleetumLanguage();
      window.requestAnimationFrame(() => {
        for (const mutation of mutations) {
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType === Node.TEXT_NODE) translateTextNode(node as Text, language);
            if (node.nodeType === Node.ELEMENT_NODE) applyTranslations(node as Element, language);
          });
          if (mutation.type === "characterData" && mutation.target.nodeType === Node.TEXT_NODE) {
            translateTextNode(mutation.target as Text, language);
          }
          if (mutation.type === "attributes" && mutation.target.nodeType === Node.ELEMENT_NODE) {
            translateElementAttributes(mutation.target as Element, language);
          }
        }
      });
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: [...ATTRIBUTES]
    });

    return () => {
      observer.disconnect();
      window.removeEventListener(FLEETUM_LANGUAGE_EVENT, onLanguageChange);
    };
  }, []);

  return null;
}
