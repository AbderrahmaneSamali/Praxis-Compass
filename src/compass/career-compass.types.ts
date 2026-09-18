export type CompassSkill = Readonly<{
  skillId: string;
  label: string;
  targetLevel: number;
  reviewed: boolean;
  shared: boolean;
}>;

export type CompassDestination = Readonly<{
  occupationId: string;
  conceptUri: string;
  label: string;
  description: string;
  language: string;
  shared: number;
  totalSkills: number;
  bridgePercentage: number;
  rawOverlapPercentage: number;
  similarityScore: number;
  sharedSkills: readonly CompassSkill[];
  bridgeSkills: readonly CompassSkill[];
  skills: readonly CompassSkill[];
}>;

export type CompassResult = Readonly<{
  metric: 'idf_weighted_destination_coverage';
  evidenceBasis: 'occupation_taxonomy';
  originOccupationId: string;
  originLabel: string;
  destinations: readonly CompassDestination[];
}>;
