import axios from 'axios'

import logger from '../utils/logger'

const log = logger({ name: 'amendment-classification' })

// The classification of an amendment as "retired" or "obsolete" is only
// authoritatively declared in rippled's features.macro file:
//   - XRPL_RETIRE_FEATURE / XRPL_RETIRE_FIX  -> retired (active 2+ years, code
//     removed, identifier deprecated, permanently baked in).
//   - VoteBehavior::Obsolete                 -> obsolete (supported but never
//     passed, kept votable but marked so no one votes for it).
// We also treat any amendment that is NOT registered in features.macro at all as
// obsolete, since rippled only removes an amendment from this file once it has
// been obsolete long enough that no client can still vote for it.
//
// We source the file from the `develop` branch on purpose: develop is the
// superset of every amendment any live network can be running - mainnet (stable)
// plus testnet/devnet (beta) - so beta amendments are still recognized and NOT
// mislabeled obsolete, while genuinely-removed dead amendments remain absent.
const FEATURES_MACRO_URL =
  'https://raw.githubusercontent.com/XRPLF/rippled/develop/include/xrpl/protocol/detail/features.macro'

/**
 * The set of amendment names classified as retired and obsolete by rippled.
 */
export interface AmendmentClassification {
  retired: Set<string>
  obsolete: Set<string>
  // Every amendment name registered in features.macro (active + retired). Used
  // to treat amendments that rippled no longer registers as obsolete.
  all: Set<string>
}

const RETIRE_FEATURE_RE = /^XRPL_RETIRE_FEATURE\s*\(\s*(?<name>[^),\s]+)/u
const RETIRE_FIX_RE = /^XRPL_RETIRE_FIX\s*\(\s*(?<name>[^),\s]+)/u
const FEATURE_RE = /^XRPL_FEATURE\s*\(\s*(?<name>[^),\s]+)/u
const FIX_RE = /^XRPL_FIX\s*\(\s*(?<name>[^),\s]+)/u

/**
 * Extract a retired amendment name from a macro line, or null. `XRPL_RETIRE_FIX`
 * names are prefixed with `fix`.
 *
 * @param line - A single trimmed line of features.macro.
 * @returns The retired amendment name, or null.
 */
function matchRetired(line: string): string | null {
  const feature = RETIRE_FEATURE_RE.exec(line)
  if (feature?.groups) {
    return feature.groups.name
  }
  const fix = RETIRE_FIX_RE.exec(line)
  if (fix?.groups) {
    return `fix${fix.groups.name}`
  }
  return null
}

/**
 * Extract an active (non-retired) amendment from a macro line, or null.
 * `XRPL_FIX` names are prefixed with `fix`.
 *
 * @param line - A single trimmed line of features.macro.
 * @returns The amendment name and whether it is obsolete, or null.
 */
function matchActive(line: string): { name: string; obsolete: boolean } | null {
  const isObsolete = line.includes('VoteBehavior::Obsolete')
  const feature = FEATURE_RE.exec(line)
  if (feature?.groups) {
    return { name: feature.groups.name, obsolete: isObsolete }
  }
  const fix = FIX_RE.exec(line)
  if (fix?.groups) {
    return { name: `fix${fix.groups.name}`, obsolete: isObsolete }
  }
  return null
}

/**
 * Parse the rippled features.macro file into the sets of retired and obsolete
 * amendment names, plus the set of every registered amendment name.
 *
 * `XRPL_FIX` / `XRPL_RETIRE_FIX` amendment names are prefixed with `fix` in
 * rippled (e.g. `XRPL_RETIRE_FIX(1201)` becomes `fix1201`), matching the names
 * returned by the feature RPC.
 *
 * @param macro - The raw contents of features.macro.
 * @returns The retired, obsolete, and all-registered amendment names.
 */
export function parseFeaturesMacro(macro: string): AmendmentClassification {
  const retired = new Set<string>()
  const obsolete = new Set<string>()
  const all = new Set<string>()

  for (const rawLine of macro.split('\n')) {
    const line = rawLine.trim()
    if (line.startsWith('//') || line.length === 0) {
      continue
    }

    const retiredName = matchRetired(line)
    if (retiredName !== null) {
      retired.add(retiredName)
      all.add(retiredName)
      continue
    }

    const active = matchActive(line)
    if (active === null) {
      continue
    }
    all.add(active.name)
    if (active.obsolete) {
      obsolete.add(active.name)
    }
  }

  return { retired, obsolete, all }
}

/**
 * Fetch and parse rippled's features.macro (from the `develop` branch) to
 * determine which amendments are retired or obsolete.
 *
 * Returns null when the file cannot be fetched (for example if the path changed
 * after a rippled restructure) or when it parses to nothing (for example if the
 * file format changed). Callers must treat null as "classification unknown" and
 * skip updating the database rather than persisting incorrect (all-false) flags.
 *
 * @returns The retired and obsolete amendment names, or null on failure.
 */
// eslint-disable-next-line max-len -- Prettier keeps this signature on one line.
export async function fetchAmendmentClassification(): Promise<AmendmentClassification | null> {
  try {
    const response = await axios.get<string>(FEATURES_MACRO_URL, {
      responseType: 'text',
    })
    const parsed = parseFeaturesMacro(response.data)
    if (parsed.retired.size === 0 && parsed.obsolete.size === 0) {
      log.error(
        `No retired/obsolete amendments parsed from ${FEATURES_MACRO_URL}; the file path or format may have changed. Skipping amendment info update.`,
      )
      return null
    }
    log.info(
      `Fetched amendment classification from ${FEATURES_MACRO_URL}: ${parsed.retired.size} retired, ${parsed.obsolete.size} obsolete, ${parsed.all.size} registered`,
    )
    return parsed
  } catch (err) {
    log.error(
      `Failed to fetch amendment classification from ${FEATURES_MACRO_URL}; skipping amendment info update.`,
      err,
    )
    return null
  }
}
