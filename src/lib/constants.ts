/**
 * Shared constants for the SMART system frontend.
 * Import from here instead of defining duplicates in each component.
 */

// ── Academic Terms ──────────────────────────────────────────────────────────
export const TERMS = ["T1", "T2", "T3"] as const;
export type Term = (typeof TERMS)[number];

export const TERM_LABELS: Record<Term, string> = {
  T1: "Term 1",
  T2: "Term 2",
  T3: "Term 3",
};

/** Maps a term string to its display label. Falls back to the raw value. */
export function termLabel(term: string): string {
  return TERM_LABELS[term as Term] ?? term;
}

// ── Grade Colors ────────────────────────────────────────────────────────────
/** Returns Tailwind text color class based on DepEd grade thresholds. */
export function getGradeColor(grade: number | null): string {
  if (grade === null) return "text-slate-300";
  if (grade >= 90) return "text-emerald-600";
  if (grade >= 85) return "text-blue-600";
  if (grade >= 80) return "text-amber-600";
  if (grade >= 75) return "text-orange-600";
  return "text-rose-600";
}

// ── Philippine DepEd Divisions ──────────────────────────────────────────────
// Source: Department of Education official division list
export const DEPED_DIVISIONS = [
  // NCR
  "Division of Manila",
  "Division of Quezon City",
  "Division of Las Piñas",
  "Division of Makati",
  "Division of Pasay",
  "Division of Taguig",
  "Division of Valenzuela",
  "Division of Caloocan",
  // Region I - Ilocos
  "Division of Ilocos Norte",
  "Division of Ilocos Sur",
  "Division of La Union",
  "Division of Pangasinan",
  "Division of Dagupan",
  // Region II - Cagayan Valley
  "Division of Cagayan",
  "Division of Isabela",
  "Division of Nueva Vizcaya",
  "Division of Quirino",
  // Region III - Central Luzon
  "Division of Batangas",
  "Division of Bulacan",
  "Division of Cabanatuan",
  "Division of Cavite",
  "Division of Nueva Ecija",
  "Division of Pampanga",
  "Division of Tarlac",
  // Region IV-A - CALABARZON
  "Division of Laguna",
  "Division of Quezon",
  "Division of Rizal",
  // Region IV-B - MIMAROPA
  "Division of Marinduque",
  "Division of Occidental Mindoro",
  "Division of Oriental Mindoro",
  "Division of Palawan",
  "Division of Puerto Princesa",
  "Division of Romblon",
  // Region V - Bicol
  "Division of Albay",
  "Division of Camarines Norte",
  "Division of Camarines Sur",
  "Division of Catanduanes",
  "Division of Masbate",
  "Division of Sorsogon",
  // Region VI - Western Visayas
  "Division of Aklan",
  "Division of Antique",
  "Division of Capiz",
  "Division of Guimaras",
  "Division of Iloilo",
  "Division of Iloilo City",
  "Division of Negros Occidental",
  "Division of Silay",
  // Region VII - Central Visayas
  "Division of Bohol",
  "Division of Cebu",
  "Division of Cebu City",
  "Division of Mandaue",
  "Division of Lapu-Lapu",
  "Division of Siquijor",
  // Region VIII - Eastern Visayas
  "Division of Biliran",
  "Division of Eastern Samar",
  "Division of Guiuan",
  "Division of Leyte",
  "Division of Northern Samar",
  "Division of Samar",
  "Division of Southern Leyte",
  // Region IX - Zamboanga
  "Division of Pagadian",
  "Division of Zamboanga City",
  "Division of Zamboanga del Norte",
  "Division of Zamboanga del Sur",
  // Region X - Northern Mindanao
  "Division of Butuan",
  "Division of Cagayan de Oro",
  "Division of Compostela Valley",
  "Division of Dinagat Islands",
  "Division of Misamis Occidental",
  "Division of Misamis Oriental",
  // Region XI - Davao
  "Division of Davao City",
  "Division of Davao del Norte",
  "Division of Davao del Sur",
  "Division of Davao Oriental",
  "Division of Generoso Santos",
  // Region XII - SOCCSKSARGEN
  "Division of Cotabato",
  "Division of General Santos",
  "Division of Maguindanao",
  "Division of Sarangani",
  "Division of South Cotabato",
  "Division of Sultan Kudarat",
  // Region XIII - CARAGA
  "Division of Agusan del Norte",
  "Division of Agusan del Sur",
  "Division of Surigao del Norte",
  "Division of Surigao del Sur",
  // ARMM
  "Division of Autonomous Region in Muslim Mindanao",
  // BARMM
  "Division of Basilan",
  "Division of Cotabato City",
  "Division of Jolo",
  "Division of Lanao del Norte",
  "Division of Lanao del Sur",
  "Division of Maguindanao del Norte",
  "Division of Maguindanao del Sur",
  "Division of Marawi",
  "Division of Tawi-Tawi",
].sort();
