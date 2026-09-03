import axios from 'axios'

import logger from '../utils/logger'

const log = logger({ name: 'amendment-classification' })

// The classification of an amendment as "retired" or "obsolete" is only
// authoritatively declared in rippled's features.macro file:
//   - XRPL_RETIRE_FEATURE / XRPL_RETIRE_FIX  -> retired (active 2+ years, code
//     removed, identifier deprecated, permanently baked in).
//   - VoteBehavior::Obsolete                 -> obsolete (supported but never
//     passed, kept votable but marked so no one votes for it).
// An amendment that is not registered in features.macro at all is also treated
// as "not votable", since rippled removes an amendment from the file once it has
// been obsolete long enough that no client can still vote for it.
//
// We parse TWO revisions and combine them:
//   - retired  <- the latest stable RELEASE tag only. Using develop would mark
//                 amendments retired before they ship in a release (premature).
//   - obsolete <- an amendment is obsolete only if it is "not votable" in BOTH
//                 the latest release AND develop. This avoids mislabeling beta
//                 amendments (present in develop, not yet in a release) and
//                 avoids prematurely obsoleting amendments still in the release.
const RIPPLED_LATEST_RELEASE_URL =
  'https://api.github.com/repos/XRPLF/rippled/releases/latest'
const DEVELOP_FEATURES_MACRO_URL =
  'https://raw.githubusercontent.com/XRPLF/rippled/develop/include/xrpl/protocol/detail/features.macro'

/**
 * The retired, obsolete, and all-registered amendment names parsed from a single
 * features.macro revision.
 */
export interface ParsedFeaturesMacro {
  retired: Set<string>
  obsolete: Set<string>
  // Amendments the build does not support (Supported::No) - it will not vote for
  // them and cannot apply them. In a release this signals the amendment has been
  // pulled (usually pending a rename); in develop it usually just means the
  // amendment is new and not ready yet.
  unsupported: Set<string>
  all: Set<string>
}

/**
 * The combined classification: the parsed features.macro of the latest stable
 * release and of develop. `retired` is taken from the release; `obsolete` is
 * derived from both (see amendments.classify).
 */
export interface AmendmentClassification {
  release: ParsedFeaturesMacro
  develop: ParsedFeaturesMacro
}

/**
 * Build the raw GitHub URL of features.macro for a given rippled ref (tag or
 * branch).
 *
 * @param ref - The rippled git ref (release tag or branch name).
 * @returns The raw GitHub URL of features.macro.
 */
function featuresMacroUrl(ref: string): string {
  return `https://raw.githubusercontent.com/XRPLF/rippled/${ref}/include/xrpl/protocol/detail/features.macro`
}

/**
 * Detect the latest stable rippled release tag (prereleases excluded) from the
 * GitHub releases API.
 *
 * @returns The latest release tag, or null if it cannot be determined.
 */
async function fetchLatestReleaseTag(): Promise<string | null> {
  try {
    const response = await axios.get<{ tag_name?: string }>(
      RIPPLED_LATEST_RELEASE_URL,
    )
    const tag = response.data.tag_name
    if (!tag) {
      log.error(
        `Latest rippled release response from ${RIPPLED_LATEST_RELEASE_URL} did not include a tag_name.`,
      )
      return null
    }
    return tag
  } catch (err) {
    log.error(
      `Failed to detect the latest rippled release tag from ${RIPPLED_LATEST_RELEASE_URL}.`,
      err,
    )
    return null
  }
}

const SUPPORTED_NO_RE = /Supported::[Nn]o/u
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
 * @returns The amendment name, whether it is obsolete, and whether it is
 * unsupported (Supported::No); or null.
 */
function matchActive(
  line: string,
): { name: string; obsolete: boolean; unsupported: boolean } | null {
  const obsolete = line.includes('VoteBehavior::Obsolete')
  const unsupported = SUPPORTED_NO_RE.test(line)
  const feature = FEATURE_RE.exec(line)
  if (feature?.groups) {
    return { name: feature.groups.name, obsolete, unsupported }
  }
  const fix = FIX_RE.exec(line)
  if (fix?.groups) {
    return { name: `fix${fix.groups.name}`, obsolete, unsupported }
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
/**
 * Classify a single trimmed features.macro line into the given sets.
 *
 * @param line - A single trimmed line of features.macro.
 * @param sets - The accumulator sets to add the amendment to.
 */
function classifyLine(line: string, sets: ParsedFeaturesMacro): void {
  const retiredName = matchRetired(line)
  if (retiredName !== null) {
    sets.retired.add(retiredName)
    sets.all.add(retiredName)
    return
  }
  const active = matchActive(line)
  if (active === null) {
    return
  }
  sets.all.add(active.name)
  if (active.obsolete) {
    sets.obsolete.add(active.name)
  }
  if (active.unsupported) {
    sets.unsupported.add(active.name)
  }
}

/**
 * Parse the rippled features.macro file into the sets of retired, obsolete, and
 * unsupported amendment names, plus the set of every registered amendment name.
 *
 * `XRPL_FIX` / `XRPL_RETIRE_FIX` amendment names are prefixed with `fix` in
 * rippled (e.g. `XRPL_RETIRE_FIX(1201)` becomes `fix1201`), matching the names
 * returned by the feature RPC.
 *
 * @param macro - The raw contents of features.macro.
 * @returns The retired, obsolete, unsupported, and all-registered names.
 */
export function parseFeaturesMacro(macro: string): ParsedFeaturesMacro {
  const sets: ParsedFeaturesMacro = {
    retired: new Set(),
    obsolete: new Set(),
    unsupported: new Set(),
    all: new Set(),
  }
  for (const rawLine of macro.split('\n')) {
    const line = rawLine.trim()
    if (!line.startsWith('//') && line.length > 0) {
      classifyLine(line, sets)
    }
  }
  return sets
}

/**
 * Fetch and parse a single features.macro revision.
 *
 * Returns null when the file cannot be fetched (for example if the path changed
 * after a rippled restructure) or when it parses to nothing (for example if the
 * file format changed) - either indicates we should not trust the result.
 *
 * @param url - The raw features.macro URL.
 * @returns The parsed features.macro, or null on failure.
 */
async function fetchFeaturesMacro(
  url: string,
): Promise<ParsedFeaturesMacro | null> {
  try {
    const response = await axios.get<string>(url, { responseType: 'text' })
    const parsed = parseFeaturesMacro(response.data)
    // A real features.macro always registers amendments and always has a
    // non-empty retire list, so either being empty means the path or format
    // changed and the result can't be trusted.
    if (parsed.all.size === 0 || parsed.retired.size === 0) {
      log.error(
        `No amendments parsed from ${url}; the file path or format may have changed.`,
      )
      return null
    }
    return parsed
  } catch (err) {
    log.error(`Failed to fetch features.macro from ${url}.`, err)
    return null
  }
}

/**
 * Fetch and parse rippled's features.macro from both the latest stable release
 * (for retired) and the develop branch (for obsolete), and return the combined
 * classification.
 *
 * Returns null when the latest release tag can't be detected, or when either
 * revision can't be fetched/parsed. Callers must treat null as "classification
 * unknown" and skip updating the database rather than persisting incorrect
 * (all-false) flags.
 *
 * @returns The combined classification, or null on failure.
 */
// eslint-disable-next-line max-len -- Prettier keeps this signature on one line.
export async function fetchAmendmentClassification(): Promise<AmendmentClassification | null> {
  const tag = await fetchLatestReleaseTag()
  if (tag === null) {
    return null
  }
  const [release, develop] = await Promise.all([
    fetchFeaturesMacro(featuresMacroUrl(tag)),
    fetchFeaturesMacro(DEVELOP_FEATURES_MACRO_URL),
  ])
  if (release === null || develop === null) {
    log.error(
      'Skipping amendment info update: could not fetch features.macro for the latest release and/or develop.',
    )
    return null
  }
  log.info(
    `Fetched amendment classification: release ${tag} (${release.retired.size} retired), develop (${develop.all.size} registered, ${develop.obsolete.size} obsolete)`,
  )
  return { release, develop }
}
