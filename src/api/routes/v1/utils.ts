import { getNetworks, query } from '../../../shared/database'
import { AgreementScore } from '../../../shared/types'

/**
 * Formats agreement score for response.
 *
 * @param agreement - Agreement Score.
 * @returns Response based on agreement score.
 */
export function formatAgreementScore(
  agreement: AgreementScore,
): { missed: number; total: number; score: string; incomplete: boolean } {
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
 * Get the chains associated with the given UNL.
 *
 * @param param - The UNL/Networks of the chain.
 * @returns The chains associated with that UNL.
 */
export async function getChains(
  param: string | undefined,
): Promise<string[] | undefined> {
  if (param == null) {
    return undefined
  }
  const networksDb = await getNetworks()
  const networks = networksDb.map((network) => network.id)
  const unls: string[] = []
  networksDb.forEach((network) => {
    unls.push(...network.unls)
  })

  let requestedField
  if (networks.includes(param)) {
    requestedField = 'networks'
  } else if (unls.includes(param)) {
    requestedField = 'unl'
  } else {
    return []
  }

  const results = await query('validators')
    .select('chain')
    .distinct()
    .where(requestedField, param)
  return results.map((result) => result.chain as string)
}
