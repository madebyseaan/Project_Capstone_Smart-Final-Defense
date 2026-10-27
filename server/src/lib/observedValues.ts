import type { ObservedValueRating } from "@prisma/client";

export interface ObservedValueBehavior {
  code: string;
  statement: string;
}

export interface ObservedValueGroup {
  coreValue: string;
  behaviors: ObservedValueBehavior[];
}

/**
 * Fixed DepEd SF9 behavior statements. Codes are persisted; statements are
 * rendered from here so the editor and the printed SF9 cannot drift apart.
 */
export const OBSERVED_VALUE_GROUPS: ObservedValueGroup[] = [
  {
    coreValue: "1. Maka-Diyos",
    behaviors: [
      { code: "MAKA_DIYOS_1", statement: "Expresses one's spiritual beliefs while respecting others." },
      { code: "MAKA_DIYOS_2", statement: "Shows adherence to ethical principles by upholding truth." },
    ],
  },
  {
    coreValue: "2. Makatao",
    behaviors: [
      { code: "MAKATAO_1", statement: "Is sensitive to individual, social, and cultural differences." },
      { code: "MAKATAO_2", statement: "Demonstrates contributions towards solidarity." },
    ],
  },
  {
    coreValue: "3. Maka-Kalikasan",
    behaviors: [
      { code: "MAKA_KALIKASAN_1", statement: "Cares for environment and utilizes resources wisely." },
    ],
  },
  {
    coreValue: "4. Maka-Bansa",
    behaviors: [
      { code: "MAKA_BANSA_1", statement: "Demonstrates pride in being a Filipino." },
      { code: "MAKA_BANSA_2", statement: "Demonstrates appropriate behavior in school and community." },
    ],
  },
];

export const OBSERVED_VALUE_BEHAVIORS = OBSERVED_VALUE_GROUPS.flatMap((group) => group.behaviors);

export const OBSERVED_VALUE_CODES = new Set(OBSERVED_VALUE_BEHAVIORS.map((behavior) => behavior.code));

export const OBSERVED_VALUE_RATINGS: ObservedValueRating[] = ["AO", "SO", "RO", "NO"];
