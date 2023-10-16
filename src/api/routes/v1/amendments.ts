/* eslint-disable max-lines -- Disable for this file. */
import { Request, Response } from 'express'

import { getNetworks, query } from '../../../shared/database'
import { AmendmentsInfo } from '../../../shared/types'
import { isEarlierVersion } from '../../../shared/utils'
import logger from '../../../shared/utils/logger'

import { CACHE_INTERVAL_MILLIS } from './utils'

interface AmendmentsInfoResponse {
  result: 'success' | 'error'
  count: number
  amendments: AmendmentsInfo[]
}

interface AmendmentsVoteResponse {
  result: 'success' | 'error'
  count: number
  amendments: Array<AmendmentsEnabled | AmendmentInVoting>
}
interface AmendmentInfoResponse {
  result: 'success' | 'error'
  amendment: AmendmentsInfo
}

interface CacheInfo {
  amendments: AmendmentsInfo[]
  time: number
}

interface AmendmentInVoting extends AmendmentsInfo {
  threshold: string
  consensus: string
  voted: {
    count: number
    validators: Array<{
      signing_key: string
      ledger_index: string
      unl: boolean
    }>
  }
}

interface AmendmentInVotingMap {
  [key: string]: {
    name: string
    rippled_version?: string
    threshold: string
    consensus: string
    validators: Array<{
      signing_key: string
      ledger_index: string
      unl: boolean
    }>
    deprecated?: boolean
  }
}

interface AmendmentsEnabled extends AmendmentsInfo {
  ledger_index?: string
  tx_hash?: string
  date?: Date
}

interface BallotAmendmentDb {
  signing_key: string
  ledger_index: string
  amendments: string
  unl?: boolean
}

interface CacheVote {
  networks: Map<string, Array<AmendmentsEnabled | AmendmentInVoting>>
  time: number
}

const CONSENSUS_FACTOR = 0.8

const log = logger({ name: 'api-amendments' })

const cacheInfo: CacheInfo = {
  amendments: [],
  time: Date.now(),
}

const cacheVote: CacheVote = {
  networks: new Map<string, Array<AmendmentsEnabled | AmendmentInVoting>>(),
  time: Date.now(),
}

const cacheEnabled = new Map<string, Set<string>>()

/**
 * Sort by rippled version callback function.
 *
 * @param prev - First callback param.
 * @param next - Second callback param.
 *
 * @returns 1 or -1.
 */
function sortByVersion(
  prev: AmendmentsInfo | AmendmentInVoting,
  next: AmendmentsInfo | AmendmentInVoting,
): number {
  if (isEarlierVersion(prev.rippled_version, next.rippled_version)) {
    return 1
  }
  return -1
}

/**
 * Updates amendments in info cache.
 *
 * @returns Void.
 */
async function cacheAmendmentsInfo(): Promise<void> {
  try {
    cacheInfo.amendments = await query('amendments_info').select('*')
    cacheInfo.amendments.sort(sortByVersion)
    cacheInfo.time = Date.now()
  } catch (err: unknown) {
    log.error('Error getting amendments info from the database', err)
  }
}

void cacheAmendmentsInfo()

/**
 * Retrieves amendments enabled on a network.
 *
 * @param id - The network id.
 * @returns List of enabled amendments.
 */
async function getEnabledAmendments(id: string): Promise<AmendmentsEnabled[]> {
  const enabled = await query('amendments_enabled')
    .leftJoin(
      'amendments_info',
      'amendments_enabled.amendment_id',
      'amendments_info.id',
    )
    .select(
      'amendments_enabled.amendment_id AS id',
      'amendments_enabled.ledger_index',
      'amendments_enabled.tx_hash',
      'amendments_enabled.date',
      'amendments_info.name',
      'amendments_info.rippled_version',
      'amendments_info.deprecated',
    )
    .where('amendments_enabled.networks', id)

  enabled.sort(sortByVersion)

  if (!cacheEnabled.has(id)) {
    cacheEnabled.set(id, new Set())
  }
  enabled.forEach((amendment: AmendmentsEnabled) => {
    cacheEnabled.get(id)?.add(amendment.id)
  })

  return enabled
}
/**
 * Adds a ballot into the amendments mapping.
 *
 * @param ballot - Amendment vote from a validator.
 * @param votingAmendments - Map of amendment to validators vote.
 */
function parseAmendmentVote(
  ballot: BallotAmendmentDb,
  votingAmendments: AmendmentInVotingMap,
): void {
  const amendmentsVoted = ballot.amendments ? ballot.amendments.split(',') : []
  amendmentsVoted.forEach((amendmentId: string) => {
    if (!(amendmentId in votingAmendments)) {
      votingAmendments[amendmentId] = {
        name: '',
        rippled_version: '',
        threshold: '',
        consensus: '',
        validators: [],
        deprecated: false,
      }
    }
    votingAmendments[amendmentId].validators.push({
      signing_key: ballot.signing_key,
      ledger_index: ballot.ledger_index,
      unl: ballot.unl ?? false,
    })
  })
}

/**
 * Calculates the consensus data for an amendment in a network.
 *
 * @param votingMap -- The map of all voting amendments on the network.
 * @param amendment_id -- The id of the amendment.
 * @param network_id -- The id of the network.
 */
async function calculateConsensus(
  votingMap: AmendmentInVotingMap,
  amendment_id: string,
  network_id: string,
): Promise<void> {
  const votedUNL = votingMap[amendment_id].validators.filter(
    (validator) => validator.unl,
  ).length
  const dbUNL = await query('validators')
    .count('signing_key AS count')
    .whereNotNull('unl')
    .andWhere('chain', network_id)

  const totalUnl: number = dbUNL[0].count

  // eslint-disable-next-line require-atomic-updates -- The threshold is only updated for each id once at a time.
  votingMap[amendment_id].threshold = `${Math.ceil(
    CONSENSUS_FACTOR * totalUnl,
  ).toString()}/${totalUnl.toString()}`
  // eslint-disable-next-line require-atomic-updates -- The concensus is only updated for each id once at a time.
  votingMap[amendment_id].consensus = (votedUNL / totalUnl).toLocaleString(
    undefined,
    { style: 'percent', minimumFractionDigits: 2 },
  )
}

/**
 * Retrieves amendments enabled on a network.
 *
 * @param id - The network id.
 * @returns List of enabled amendments.
 */
async function getVotingAmendments(id: string): Promise<AmendmentInVoting[]> {
  const inNetworks: BallotAmendmentDb[] = await query('ballot')
    .leftJoin('validators', 'ballot.signing_key', 'validators.signing_key')
    .select(
      'ballot.signing_key',
      'ballot.ledger_index',
      'ballot.amendments',
      'validators.unl',
    )
    .where('validators.networks', id)

  const votingAmendments: AmendmentInVotingMap = {}

  inNetworks.forEach((val) => {
    parseAmendmentVote(val, votingAmendments)
  })

  if (Date.now() - cacheInfo.time > CACHE_INTERVAL_MILLIS) {
    await cacheAmendmentsInfo()
  }

  for (const amendment of cacheInfo.amendments) {
    if (amendment.id in votingAmendments) {
      votingAmendments[amendment.id].name = amendment.name
      votingAmendments[amendment.id].rippled_version = amendment.rippled_version
      votingAmendments[amendment.id].deprecated = amendment.deprecated
      await calculateConsensus(votingAmendments, amendment.id, id)
    }
  }

  const res: AmendmentInVoting[] = []
  for (const [key, value] of Object.entries(votingAmendments)) {
    if (!cacheEnabled.get(id)?.has(key)) {
      res.push({
        id: key,
        name: value.name,
        rippled_version: value.rippled_version,
        deprecated: value.deprecated,
        threshold: value.threshold,
        consensus: value.consensus,
        voted: {
          count: value.validators.length,
          validators: value.validators,
        },
      })
    }
  }

  res.sort(sortByVersion)

  return res
}

/**
 * Updates amendments in voting cache.
 *
 * @returns Void.
 */
async function cacheAmendmentsVote(): Promise<void> {
  try {
    const networks = (await getNetworks()).map((network) => network.id)
    networks.forEach(async (id: string) => {
      const enabled = await getEnabledAmendments(id)
      const voting = await getVotingAmendments(id)
      cacheVote.networks.set(id, enabled.concat(voting))
    })
    cacheVote.time = Date.now()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TODO: clean up
  } catch (err: any) {
    log.error(err.toString())
  }
}

void cacheAmendmentsVote()

/**
 * Handles Amendments Info request.
 *
 * @param _u - Unused express request.
 * @param res - Express response.
 */
export async function handleAmendmentsInfo(
  _u: Request,
  res: Response,
): Promise<void> {
  try {
    if (Date.now() - cacheInfo.time > CACHE_INTERVAL_MILLIS) {
      await cacheAmendmentsInfo()
    }
    const amendments: AmendmentsInfo[] = cacheInfo.amendments
    const response: AmendmentsInfoResponse = {
      result: 'success',
      count: amendments.length,
      amendments,
    }
    res.send(response)
  } catch {
    res.send({ result: 'error', message: 'internal error' })
  }
}

/**
 * Handles Amendment Info request.
 *
 * @param req - Express request.
 * @param res - Express response.
 */
export async function handleAmendmentInfo(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const { param } = req.params
    if (Date.now() - cacheInfo.time > CACHE_INTERVAL_MILLIS) {
      await cacheAmendmentsInfo()
    }
    const amendments: AmendmentsInfo[] = cacheInfo.amendments.filter(
      (amend) => amend.name === param || amend.id === param,
    )
    if (amendments.length === 0) {
      res.send({ result: 'error', message: "incorrect amendment's id/name" })
      return
    }
    const response: AmendmentInfoResponse = {
      result: 'success',
      amendment: amendments[0],
    }
    res.send(response)
  } catch {
    res.send({ result: 'error', message: 'internal error' })
  }
}

/**
 * Handles Amendments Voting request.
 *
 * @param req - Express request.
 * @param res - Express response.
 */
export async function handleAmendmentsVote(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const { network } = req.params
    if (Date.now() - cacheVote.time > CACHE_INTERVAL_MILLIS) {
      await cacheAmendmentsVote()
    }
    const networkVotes:
      | Array<AmendmentsEnabled | AmendmentInVoting>
      | undefined = cacheVote.networks.get(network)
    if (networkVotes) {
      const response: AmendmentsVoteResponse = {
        result: 'success',
        count: networkVotes.length,
        amendments: networkVotes,
      }
      res.send(response)
    } else {
      res.send({ result: 'error', message: 'network not found' })
    }
  } catch {
    res.send({ result: 'error', message: 'internal error' })
  }
}

/**
 * Handles Amendment Voting request.
 *
 * @param req - Express request.
 * @param res - Express response.
 */
export async function handleAmendmentVote(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const { network, identifier } = req.params
    if (Date.now() - cacheVote.time > CACHE_INTERVAL_MILLIS) {
      await cacheAmendmentsVote()
    }
    const networkVotes:
      | Array<AmendmentsEnabled | AmendmentInVoting>
      | undefined = cacheVote.networks.get(network)
    if (networkVotes === undefined) {
      res.send({ result: 'error', message: 'network not found' })
    }

    const amendment = (
      networkVotes as Array<AmendmentsEnabled | AmendmentInVoting>
    ).filter((amend) => amend.id === identifier || amend.name === identifier)

    if (amendment.length > 0) {
      res.send({
        result: 'success',
        amendment: amendment[0],
      })
    } else {
      res.status(404).send({
        result: 'error',
        message: 'amendment with id/name not found',
      })
    }
  } catch {
    res.send({ result: 'error', message: 'internal error' })
  }
}
