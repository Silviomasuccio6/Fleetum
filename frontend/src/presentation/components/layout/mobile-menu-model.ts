import { matchSections, type SectionEntry } from "./section-search-model";

type Entry<T> = { label: string; to?: string; children?: T[] };

/** Intersect the existing navigation with the existing access catalogue. Never add catalogue-only routes. */
export function mobileMenuSections<T extends Entry<T>>(
  sections: ReadonlyArray<{ title: string; items: T[] }>,
  authorized: ReadonlyArray<Pick<SectionEntry, "to">>,
  query: string,
  translate: (value: string) => string = value => value
) {
  const allowed = new Set(authorized.map(entry => entry.to));
  const seen = new Set<string>();
  return sections.map(section => {
    const items = section.items.flatMap(item => item.children?.length ? item.children : [item])
      .filter((item): item is T & { to: string } => Boolean(item.to && allowed.has(item.to)))
      .filter(item => { if (seen.has(item.to)) return false; seen.add(item.to); return true; });
    const matches = new Set(matchSections(items.map(item => ({
      to: item.to, label: `${item.label} ${translate(item.label)}`,
      group: `${section.title} ${translate(section.title)}`
    })), query).map(item => item.to));
    return { title: section.title, items: items.filter(item => matches.has(item.to)) };
  }).filter(section => section.items.length > 0);
}
