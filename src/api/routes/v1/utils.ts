import { getNetworks, query } from '../../../shared/database'
import { AgreementScore } from '../../../shared/types'

export const CACHE_INTERVAL_MILLIS = 60 * 1000

// Agreement rows are keyed by `master_key ?? signing_key` (see
// `saveDailyAgreement` in the connection-manager), so reads must join on that
// same effective key. Validators that never published a manifest have a null
// `master_key` and are only reachable by signing key.
export const EFFECTIVE_KEY =
  'COALESCE(validators.master_key, validators.signing_key)'

// `validators.master_key` can be null even when a manifest records one, so fall
// back to the manifest before the signing key when naming a validator.
const MANIFEST_MASTER_KEY = `(SELECT m.master_key FROM manifests m
     WHERE m.signing_key = validators.signing_key LIMIT 1)`

// A validator's master key, taken from `validators` when set and from the
// manifest otherwise. Null when the validator genuinely has no master key.
export const RESOLVED_MASTER_KEY = `COALESCE(validators.master_key, ${MANIFEST_MASTER_KEY})`

// The key a validator is reported under: its master key when known from either
// source, otherwise its signing key. Never null.
export const CANONICAL_KEY = `COALESCE(${RESOLVED_MASTER_KEY}, validators.signing_key)`

// Matches a validator by any key that identifies it. The manifest lookup covers
// validators whose `validators.master_key` is null despite a known manifest,
// which would otherwise be unreachable by master key.
export const MATCHES_PUBLIC_KEY = `(
  validators.master_key = ?
  OR validators.signing_key = ?
  OR EXISTS (
    SELECT 1 FROM manifests m
     WHERE m.signing_key = validators.signing_key AND m.master_key = ?
  )
)`

/**
 * Formats agreement score for response.
 *
 * @param agreement - Agreement Score.
 * @returns Response based on agreement score.
 */
export function formatAgreementScore(agreement: AgreementScore): {
  missed: number
  total: number
  score: string
  incomplete: boolean
} {
  const { validated, missed, incomplete } = agreement
  const total = missed + validated

  const score = total === 0 ? 0 : validated / total

  return {
    missed,
    total,
    score: score.toFixed(5),
    incomplete,
  }
}

/**
 * Formats amendments from string to list.
 *
 * @param amendmentsDb - Amendments string from database.
 * @returns A list of amendments.
 */
export async function formatAmendments(
  amendmentsDb: string,
): Promise<Array<{ id: string; name: string }>> {
  const res: Array<{ id: string; name: string }> = []
  const amendmentsList = amendmentsDb.split(',')
  await Promise.all(
    amendmentsList.map(async (amendment) => {
      const info = (await query('amendments_info')
        .select('id', 'name')
        .where('id', amendment)
        .first()) as { id: string; name: string }
      res.push(info)
    }),
  )
  return res
}

/**
 * Get param type from validator API call.
 *
 * @param param - The input parameter.
 * @returns The type of the input parameter (unl/networks/unknown).
 */
export async function getParamType(
  param: string | undefined,
): Promise<'networks' | 'unl' | undefined> {
  if (!param) {
    return undefined
  }
  const networksDb = await getNetworks()
  const networks = networksDb.map((network) => network.id)
  const unls: string[] = []
  networksDb.forEach((network) => {
    unls.push(...network.unls)
  })
  if (networks.includes(param)) {
    return 'networks'
  }
  if (unls.includes(param)) {
    return 'unl'
  }

  return undefined
}

/**
 * Get the chains associated with the given UNL.
 *
 * @param unl - The UNL of the chain.
 * @returns The chains associated with that UNL.
 */
export async function getChains(unl: string): Promise<string[] | undefined> {
  const results = (await query('validators')
    .select('chain')
    .distinct()
    .where('unl', unl)) as Array<{ chain: string }>
  return results.map((result) => result.chain)
}
