export const fixtureId = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const personas = {
  editor: { org: 1, member: 101 },
  viewer: { org: 1, member: 102 },
  other: { org: 2, member: 201 },
} as const;
