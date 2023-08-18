import { Request, Response } from 'express'

import { staleAmendmentsData } from '../../../connection-manager/amendments'
import { getNetworks, query } from '../../../shared/database'
import { AmendmentsInfo } from '../../../shared/types'
import { isEarlierVersion } from '../../../shared/utils'
import logger from '../../../shared/utils/logger'

interface AmendmentsInfoResponse {
  result: 'success' | 'error'
  count: number
  stale_name: boolean
  stale_version: boolean
  amendments: AmendmentsInfo[]
}

interface AmendmentsVoteResponse {
  result: 'success' | 'error'
  amendments: AmendmentsVote
}

interface CacheInfo {
  amendments: AmendmentsInfo[]
  time: number
}

interface AmendmentInVoting extends AmendmentsInfo {
  voted: {
    count: number
    validators: Array<{ signing_key: string; ledger_index: string }>
  }
}

interface BallotAmendmentDb {
  signing_key: string
  ledger_index: string
  amendments: string
}

interface AmendmentsVote {
  enabled: {
    count: number
    amendments: AmendmentsInfo[]
  }
  voting: {
    count: number
    amendments: AmendmentInVoting[]
  }
}

interface CacheVote {
  networks: Map<string, AmendmentsVote>
  time: number
}

const log = logger({ name: 'api-amendments' })

const cacheInfo: CacheInfo = {
  amendments: [],
  time: Date.now(),
}

const cacheVote: CacheVote = {
  networks: new Map<string, AmendmentsVote>(),
  time: Date.now(),
}

/**
 * Updates amendments in info cache.
 *
 * @returns Void.
 */
async function cacheAmendmentsInfo(): Promise<void> {
  try {
    cacheInfo.amendments = await query('amendments_info').select('*')
    cacheInfo.amendments.sort((prev: AmendmentsInfo, next: AmendmentsInfo) => {
      if (isEarlierVersion(prev.rippled_version, next.rippled_version)) {
        return 1
      }
      return -1
    })
    cacheInfo.time = Date.now()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TODO: clean up
  } catch (err: any) {
    log.error(err.toString())
  }
}

void cacheAmendmentsInfo()

/**
 * Retrieves amendments enabled on a network.
 *
 * @param id - The network id.
 * @returns List of enabled amendments.
 */
async function getEnabledAmendments(id: string): Promise<AmendmentsInfo[]> {
  return query('amendments_enabled')
    .leftJoin(
      'amendments_info',
      'amendments_enabled.amendment_id',
      'amendments_info.id',
    )
    .select(
      'amendments_enabled.amendment_id AS id',
      'amendments_info.name',
      'amendments_info.rippled_version',
    )
    .where('amendments_enabled.networks', id)
}
/**
 * Adds a ballot into the amendments mapping.
 *
 * @param ballot - Amendment vote from a validator.
 * @param votingAmendments - Map of amendment to validators vote.
 */
function parseAmendmentVote(
  ballot: BallotAmendmentDb,
  votingAmendments: {
    [key: string]: {
      name: string
      rippled_version: string | undefined | null
      validators: Array<{ signing_key: string; ledger_index: string }>
    }
  },
): void {
  const amendmentsVoted = ballot.amendments ? ballot.amendments.split(',') : []
  amendmentsVoted.forEach((amendmentId: string) => {
    if (!(amendmentId in votingAmendments)) {
      votingAmendments[amendmentId] = {
        name: '',
        rippled_version: '',
        validators: [],
      }
    }
    votingAmendments[amendmentId].validators.push({
      signing_key: ballot.signing_key,
      ledger_index: ballot.ledger_index,
    })
  })
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
    .select('ballot.signing_key', 'ballot.ledger_index', 'ballot.amendments')
    .where('validators.networks', id)

  const votingAmendments: {
    [key: string]: {
      name: string
      rippled_version: string | undefined | null
      validators: Array<{ signing_key: string; ledger_index: string }>
    }
  } = {}

  inNetworks.forEach((val) => {
    parseAmendmentVote(val, votingAmendments)
  })

  if (Date.now() - cacheInfo.time > 60 * 1000) {
    await cacheAmendmentsInfo()
  }

  cacheInfo.amendments.forEach((amendment) => {
    if (amendment.id in votingAmendments) {
      votingAmendments[amendment.id].name = amendment.name
      votingAmendments[amendment.id].rippled_version = amendment.rippled_version
    }
  })

  const res: AmendmentInVoting[] = []

  for (const [key, value] of Object.entries(votingAmendments)) {
    res.push({
      id: key,
      name: value.name,
      rippled_version: value.rippled_version,
      voted: {
        count: value.validators.length,
        validators: value.validators,
      },
    })
  }

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
      cacheVote.networks.set(id, {
        enabled: {
          count: enabled.length,
          amendments: enabled,
        },
        voting: {
          count: voting.length,
          amendments: voting,
        },
      })
    })
    cacheVote.time = Date.now()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TODO: clean up
  } catch (err: any) {
    log.error(err.toString())
  }
}

void cacheAmendmentsVote()

/**
 * Handles Amendment Info request.
 *
 * @param _u - Unused express request.
 * @param res - Express response.
 */
export async function handleAmendmentsInfo(
  _u: Request,
  res: Response,
): Promise<void> {
  try {
    if (Date.now() - cacheInfo.time > 60 * 1000) {
      await cacheAmendmentsInfo()
    }
    const amendments: AmendmentsInfo[] = cacheInfo.amendments
    const response: AmendmentsInfoResponse = {
      result: 'success',
      count: amendments.length,
      stale_name: staleAmendmentsData.staleName,
      stale_version: staleAmendmentsData.staleVersion,
      amendments,
    }
    res.send(response)
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
export async function handleAmendmentsVote(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const { network } = req.params
    if (Date.now() - cacheVote.time > 60 * 1000) {
      await cacheAmendmentsVote()
    }
    const networkVotes: AmendmentsVote | undefined =
      cacheVote.networks.get(network)
    if (networkVotes) {
      const response: AmendmentsVoteResponse = {
        result: 'success',
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
