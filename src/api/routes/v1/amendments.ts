/* eslint-disable max-lines -- Disable for this file. */
import { Request, Response } from 'express'

import { getNetworks, query } from '../../../shared/database'
import { AmendmentStatus, AmendmentInfo } from '../../../shared/types'
import { isEarlierVersion } from '../../../shared/utils'
import logger from '../../../shared/utils/logger'

import { CACHE_INTERVAL_MILLIS } from './utils'

interface AmendmentsInfoResponse {
  result: 'success' | 'error'
  count: number
  amendments: AmendmentInfo[]
}

interface AmendmentsVoteResponse {
  result: 'success' | 'error'
  count: number
  amendments: Array<EnabledAmendmentInfo | AmendmentInVoting>
}

interface SingleAmendmentInfoResponse {
  result: 'success' | 'error'
  amendment: AmendmentInfo
}

interface CacheInfo {
  amendments: AmendmentInfo[]
  time: number
}

interface VotingValidators {
  signing_key: string
  ledger_index: string
  unl: boolean
}

interface AmendmentsInfoExtended extends AmendmentInfo {
  threshold: string
  consensus: string
  eta?: Date
}

interface AmendmentInVoting extends AmendmentsInfoExtended {
  voted: {
    count: number
    validators: VotingValidators[]
  }
}

interface AmendmentInVotingMap {
  [key: string]: Omit<AmendmentsInfoExtended, 'id'> & {
    validators: VotingValidators[]
  }
}

interface EnabledAmendmentInfo extends AmendmentInfo {
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
  networks: Map<string, Array<EnabledAmendmentInfo | AmendmentInVoting>>
  time: number
}

const CONSENSUS_FACTOR = 0.8

const log = logger({ name: 'api-amendments' })

const cacheInfo: CacheInfo = {
  amendments: [],
  time: Date.now(),
}

const cacheVote: CacheVote = {
  networks: new Map<string, Array<EnabledAmendmentInfo | AmendmentInVoting>>(),
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
  prev: AmendmentInfo | AmendmentInVoting,
  next: AmendmentInfo | AmendmentInVoting,
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
    cacheInfo.amendments = (await query('amendments_info').select(
      '*',
    )) as AmendmentInfo[]
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
async function getEnabledAmendments(
  id: string,
): Promise<EnabledAmendmentInfo[]> {
  const enabled = (await query('amendments_status')
    .leftJoin(
      'amendments_info',
      'amendments_status.amendment_id',
      'amendments_info.id',
    )
    .select(
      'amendments_status.amendment_id AS id',
      'amendments_status.ledger_index',
      'amendments_status.tx_hash',
      'amendments_status.date',
      'amendments_info.name',
      'amendments_info.rippled_version',
      'amendments_info.deprecated',
    )
    .where('amendments_status.networks', id)
    .whereNull('amendments_status.eta')) as EnabledAmendmentInfo[]

  enabled.sort(sortByVersion)

  if (!cacheEnabled.has(id)) {
    cacheEnabled.set(id, new Set())
  }
  enabled.forEach((amendment: EnabledAmendmentInfo) => {
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
  const dbUNL = (await query('validators')
    .count('signing_key AS count')
    .whereNotNull('unl')
    .andWhere('chain', network_id)) as Array<{ count: number }>

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
 * Retrieves amendments in voting on a network.
 *
 * @param id - The network id.
 * @returns List of amendments in voting.
 */
// eslint-disable-next-line max-lines-per-function, max-statements -- Disabled for this function.
async function getVotingAmendments(id: string): Promise<AmendmentInVoting[]> {
  const inNetworks = (await query('ballot')
    .leftJoin('validators', 'ballot.signing_key', 'validators.signing_key')
    .select(
      'ballot.signing_key',
      'ballot.ledger_index',
      'ballot.amendments',
      'validators.unl',
    )
    .where('validators.networks', id)) as BallotAmendmentDb[]

  const incomingAmendments = (await query('amendments_status')
    .select('*')
    .where('networks', id)
    .whereNotNull('eta')
    .whereNull('date')) as AmendmentStatus[]

  const votingAmendments: AmendmentInVotingMap = {}

  inNetworks.forEach((val) => {
    parseAmendmentVote(val, votingAmendments)
  })

  for (const amendment of incomingAmendments) {
    if (amendment.amendment_id in votingAmendments) {
      votingAmendments[amendment.amendment_id].eta = amendment.eta
    }
  }

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
        eta: value.eta,
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
    log.error(err)
  }
}

void cacheAmendmentsVote()
void cacheAmendmentsInfo()

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
    const amendments: AmendmentInfo[] = cacheInfo.amendments
    const response: AmendmentsInfoResponse = {
      result: 'success',
      count: amendments.length,
      amendments,
    }
    res.status(200).send(response)
  } catch (err: unknown) {
    log.error('Error handleAmendmentsInfo: ', err)
    res.status(500).send({
      result: 'error',
      message: `internal error: ${(err as Error).message}`,
    })
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
    const amendments: AmendmentInfo[] = cacheInfo.amendments.filter(
      (amend) => amend.name === param || amend.id === param,
    )
    if (amendments.length === 0) {
      log.error(
        `Error handleAmendmentInfo: amendment not found. amendment id/name = ${param}`,
      )
      res.status(404).send({
        result: 'error',
        message: "incorrect amendment's id/name",
      })
      return
    }
    if (amendments.length > 1) {
      log.error(
        `Error handleAmendmentInfo: there's a duplicate amendment's id/name on the server. amendment id/name = ${param}, amendments length = ${amendments.length}`,
      )
      res.status(404).send({
        result: 'error',
        message:
          "there's a duplicate amendment's id/name on the server, please try again later",
      })
      log.error("there's a duplicate amendment's id/name on the server", param)
      return
    }
    const response: SingleAmendmentInfoResponse = {
      result: 'success',
      amendment: amendments[0],
    }
    res.status(200).send(response)
  } catch (err: unknown) {
    log.error('Error handleAmendmentInfo: ', err)
    res.status(500).send({
      result: 'error',
      message: `internal error: ${(err as Error).message}`,
    })
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
      | Array<EnabledAmendmentInfo | AmendmentInVoting>
      | undefined = cacheVote.networks.get(network)
    if (networkVotes) {
      const response: AmendmentsVoteResponse = {
        result: 'success',
        count: networkVotes.length,
        amendments: networkVotes,
      }
      res.status(200).send(response)
    } else {
      log.error(
        `Error handleAmendmentsVote: network not found. network = ${network}`,
      )
      res.status(404).send({ result: 'error', message: 'network not found' })
    }
  } catch (err: unknown) {
    log.error('Error handleAmendmentsVote: ', err)
    res.status(500).send({
      result: 'error',
      message: `internal error: ${(err as Error).message}`,
    })
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
      | Array<EnabledAmendmentInfo | AmendmentInVoting>
      | undefined = cacheVote.networks.get(network)
    if (networkVotes === undefined) {
      log.error(
        'Error handleAmendmentVote: network not found. network = ',
        network,
      )
      res.status(404).send({ result: 'error', message: 'network not found' })
    }

    const amendment = (
      networkVotes as Array<EnabledAmendmentInfo | AmendmentInVoting>
    ).filter((amend) => amend.id === identifier || amend.name === identifier)

    if (amendment.length > 0) {
      res.status(200).send({
        result: 'success',
        amendment: amendment[0],
      })
    } else {
      log.error(
        `Error handleAmendmentVote: amendment not found. network = ${network}, identifier = ${identifier}`,
      )
      res.status(404).send({
        result: 'error',
        message: 'amendment with id/name not found',
      })
    }
  } catch (err: unknown) {
    log.error('Error handleAmendmentVote: ', err)
    res.status(500).send({
      result: 'error',
      message: `internal error: ${(err as Error).message}`,
    })
  }
}
