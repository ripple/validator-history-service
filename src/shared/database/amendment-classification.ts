import axios from 'axios'

import logger from '../utils/logger'

const log = logger({ name: 'amendment-classification' })

// The classification of an amendment as "retired" or "obsolete" is only
// authoritatively declared in rippled's features.macro file:
//   - XRPL_RETIRE_FEATURE / XRPL_RETIRE_FIX  -> retired (active 2+ years, code
//     removed, identifier deprecated, permanently baked in).
//   - VoteBehavior::Obsolete                 -> obsolete (supported but never
//     passed, kept votable but marked so no one votes for it).
// Neither is reliably derivable from the (public) feature RPC, so we parse the
// file directly. We source it from the latest stable rippled release tag (NOT
// `develop`), auto-detected from the GitHub releases API, so the classification
// tracks releases without any manual configuration.
const RIPPLED_LATEST_RELEASE_URL =
  'https://api.github.com/repos/XRPLF/rippled/releases/latest'

/**
 * The set of amendment names classified as retired and obsolete by rippled.
 */
export interface AmendmentClassification {
  retired: Set<string>
  obsolete: Set<string>
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

/**
 * Build the URL of the features.macro file for a given rippled release tag.
 *
 * @param tag - The rippled release tag.
 * @returns The raw GitHub URL of features.macro.
 */
function featuresMacroUrl(tag: string): string {
  return `https://raw.githubusercontent.com/XRPLF/rippled/${tag}/include/xrpl/protocol/detail/features.macro`
}

const RETIRE_FEATURE_RE = /^XRPL_RETIRE_FEATURE\s*\(\s*(?<name>[^),\s]+)/u
const RETIRE_FIX_RE = /^XRPL_RETIRE_FIX\s*\(\s*(?<name>[^),\s]+)/u
const FEATURE_RE = /^XRPL_FEATURE\s*\(\s*(?<name>[^),\s]+)/u
const FIX_RE = /^XRPL_FIX\s*\(\s*(?<name>[^),\s]+)/u

/**
 * Extract the obsolete amendment name from a macro line, or null when the line
 * is not an obsolete feature/fix. `XRPL_FIX` names are prefixed with `fix`.
 *
 * @param line - A single trimmed line of features.macro.
 * @returns The obsolete amendment name, or null.
 */
function parseObsolete(line: string): string | null {
  if (!line.includes('VoteBehavior::Obsolete')) {
    return null
  }
  const feature = FEATURE_RE.exec(line)
  if (feature?.groups) {
    return feature.groups.name
  }
  const fix = FIX_RE.exec(line)
  if (fix?.groups) {
    return `fix${fix.groups.name}`
  }
  return null
}

/**
 * Parse the rippled features.macro file into the sets of retired and obsolete
 * amendment names.
 *
 * `XRPL_FIX` / `XRPL_RETIRE_FIX` amendment names are prefixed with `fix` in
 * rippled (e.g. `XRPL_RETIRE_FIX(1201)` becomes `fix1201`), matching the names
 * returned by the feature RPC.
 *
 * @param macro - The raw contents of features.macro.
 * @returns The retired and obsolete amendment names.
 */
export function parseFeaturesMacro(macro: string): AmendmentClassification {
  const retired = new Set<string>()
  const obsolete = new Set<string>()

  for (const rawLine of macro.split('\n')) {
    const line = rawLine.trim()
    if (line.startsWith('//') || line.length === 0) {
      continue
    }

    const retireFeature = RETIRE_FEATURE_RE.exec(line)
    if (retireFeature?.groups) {
      retired.add(retireFeature.groups.name)
      continue
    }

    const retireFix = RETIRE_FIX_RE.exec(line)
    if (retireFix?.groups) {
      retired.add(`fix${retireFix.groups.name}`)
      continue
    }

    const obsoleteName = parseObsolete(line)
    if (obsoleteName !== null) {
      obsolete.add(obsoleteName)
    }
  }

  return { retired, obsolete }
}

/**
 * Fetch and parse rippled's features.macro to determine which amendments are
 * retired or obsolete. The file is sourced from the latest stable rippled
 * release, auto-detected from the GitHub releases API.
 *
 * Returns null when the latest release tag can't be detected, when the file
 * cannot be fetched (for example if the path changed after a rippled
 * restructure), or when it parses to nothing (for example if the file format
 * changed). Callers must treat null as "classification unknown" and skip
 * updating the database rather than persisting incorrect (all-false) flags.
 *
 * @returns The retired and obsolete amendment names, or null on failure.
 */
// eslint-disable-next-line max-len -- Prettier keeps this signature on one line.
export async function fetchAmendmentClassification(): Promise<AmendmentClassification | null> {
  const tag = await fetchLatestReleaseTag()
  if (tag === null) {
    return null
  }
  const url = featuresMacroUrl(tag)
  try {
    const response = await axios.get<string>(url, { responseType: 'text' })
    const parsed = parseFeaturesMacro(response.data)
    if (parsed.retired.size === 0 && parsed.obsolete.size === 0) {
      log.error(
        `No retired/obsolete amendments parsed from ${url}; the file path or format may have changed. Skipping amendment info update.`,
      )
      return null
    }
    log.info(
      `Fetched amendment classification from ${url}: ${parsed.retired.size} retired, ${parsed.obsolete.size} obsolete`,
    )
    return parsed
  } catch (err) {
    log.error(
      `Failed to fetch amendment classification from ${url}; skipping amendment info update.`,
      err,
    )
    return null
  }
}
