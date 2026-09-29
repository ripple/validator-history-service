import { getNetworks, query } from '../../../shared/database'
import { AgreementScore } from '../../../shared/types'

export const CACHE_INTERVAL_MILLIS = 60 * 1000
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
