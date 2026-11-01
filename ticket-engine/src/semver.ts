// Dependency-free semver compare for the client version gate
// (LOCAL-MIGRATION-AND-SEED.md §E). Deliberately tiny: the gate only needs
// major.minor.patch ordering.
//
// Behavior (documented decisions):
// - Accepts `major[.minor[.patch]]` with numeric segments only. Partial
//   versions are zero-padded: `1.4` === `1.4.0`.
// - Anything else (empty, `1.4.x`, `abc`, `1.2.3-beta`, `v1.2.3`) is
//   UNPARSEABLE. Unparseable inputs compare EQUAL (returns 0) so the gate
//   fails open: a bad version string never triggers the update banner.
// - Pre-release/build-metadata precedence is not supported (the gate only
//   compares released numeric versions).

const SEMVER_RE = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?$/;

export function parseSemver(value: string): [number, number, number] | null {
  const match = SEMVER_RE.exec(value.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)];
}

export function isValidSemver(value: string): boolean {
  return parseSemver(value) !== null;
}

export function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return 0;
  const [aMaj, aMin, aPat] = pa;
  const [bMaj, bMin, bPat] = pb;
  const cmp = aMaj - bMaj || aMin - bMin || aPat - bPat;
  return cmp < 0 ? -1 : cmp > 0 ? 1 : 0;
}
