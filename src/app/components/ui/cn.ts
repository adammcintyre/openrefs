/**
 * Joins class names, dropping falsy entries.
 *
 * Deliberately not tailwind-merge: the only dependency this wave may add is
 * lucide-react. So this does NOT de-duplicate conflicting utilities — passing
 * `className="p-8"` to a component whose base is `p-4` leaves both classes on
 * the element and the winner is decided by their order in Tailwind's generated
 * stylesheet, not by the order here. Components below therefore keep their
 * base classes minimal and put the consumer's className last, which covers
 * additive cases (margin, width, grid placement) reliably. Reach for a variant
 * prop rather than overriding a base utility.
 */
export type ClassValue = string | false | null | undefined;

export function cn(...values: ClassValue[]): string {
  return values.filter(Boolean).join(" ");
}
