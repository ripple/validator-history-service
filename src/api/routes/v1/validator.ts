/* eslint-disable max-lines -- Disabled for this file. */
import { Request, Response } from 'express'

import { query } from '../../../shared/database'
import logger from '../../../shared/utils/logger'

import {
  CACHE_INTERVAL_MILLIS,
  formatAgreementScore,
  formatAmendments,
  getChains,
  getParamType,
} from './utils'

const log = logger({ name: 'api-validator' })

interface Cache {
  validators: ValidatorResponse[]
  time: number
}

interface ValidatorResponse {
  validation_public_key: string
  signing_key: string
  master_key?: string
  revoked?: boolean
  domain: string
  chain: string
  networks?: string
  current_index: number
  server_version?: string
  agreement_1h: {
    missed: number
    total: number
    score: string
    incomplete: boolean
  } | null
  agreement_24h: {
    missed: number
    total: number
    score: string
    incomplete: boolean
  } | null
  agreement_30day: {
    missed: number
    total: number
    score: string
    incomplete: boolean
  } | null
  partial: boolean
  unl: boolean
  amendments?: Array<{ id: string; name: string }>
  base_fee?: number
  reserve_base?: number
  reserve_inc?: number
}

interface ValidatorsResponse {
  result: 'success' | 'error'
  count: number
  validators: ValidatorResponse[]
}

interface dbResponse {
  partial: boolean
  unl?: boolean
  agreement_1hour: {
    validated: number
    missed: number
    incomplete: boolean
  } | null
  agreement_24hour: {
    validated: number
    missed: number
    incomplete: boolean
  } | null
  agreement_30day: {
    validated: number
    missed: number
    incomplete: boolean
  } | null
  current_index: string
  domain: string
  chain: string
  networks?: string
  server_version?: string
  master_key?: string
  signing_key: string
  revoked?: boolean
  amendments?: string
  base_fee?: number
  reserve_base?: number
  reserve_inc?: number
}

const cache: Cache = {
  validators: [],
  time: Date.now(),
}

/**
 * Gets Validators from database.
 *
 * @returns List of Validators.
 */
async function getValidators(): Promise<ValidatorResponse[]> {
  return query('validators')
    .join('ballot', 'validators.signing_key', 'ballot.signing_key')
    .select([
      'validators.partial',
      'validators.unl',
      'validators.agreement_1hour',
      'validators.agreement_24hour',
      'validators.agreement_30day',
      'validators.current_index',
      'validators.domain',
      'validators.chain',
      'validators.networks',
      'validators.server_version',
      'validators.master_key',
      'validators.signing_key',
      'validators.master_key',
      'validators.revoked',
      'ballot.amendments',
      'ballot.base_fee',
      'ballot.reserve_base',
      'ballot.reserve_inc',
    ])
    .where('validators.revoked', '=', 'false')
    .orderBy(['validators.master_key', 'validators.signing_key'])
    .then(async (res: dbResponse[]) => Promise.all(res.map(formatResponse)))
}

/**
 * Updates validators in cache.
 *
 * @returns Void.
 */
async function cacheValidators(): Promise<void> {
  try {
    cache.validators = await getValidators()
    cache.time = Date.now()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TODO: clean up
  } catch (err: any) {
    log.error(err)
  }
}

/**
 * Format response to be sent back to client.
 *
 * @param resp - Database response.
 * @returns Validator in correct response format.
 */
async function formatResponse(resp: dbResponse): Promise<ValidatorResponse> {
  const { agreement_1hour, agreement_24hour, agreement_30day, amendments } =
    resp
  let hour1_score = null
  let hour24_score = null
  let day30_score = null
  let amendments_list

  if (agreement_1hour !== null) {
    hour1_score = formatAgreementScore(agreement_1hour)
  }

  if (agreement_24hour !== null) {
    hour24_score = formatAgreementScore(agreement_24hour)
  }

  if (agreement_30day !== null) {
    day30_score = formatAgreementScore(agreement_30day)
  }

  if (amendments) {
    amendments_list = await formatAmendments(amendments)
  }

  return {
    validation_public_key: resp.master_key ?? resp.signing_key,
    signing_key: resp.signing_key,
    master_key: resp.master_key,
    domain: resp.domain,
    chain: resp.chain,
    server_version: resp.server_version,
    networks: resp.networks,
    current_index: Number(resp.current_index),
    agreement_1h: hour1_score,
    agreement_24h: hour24_score,
    agreement_30day: day30_score,
    partial: resp.partial,
    unl: resp.unl ?? false,
    revoked: resp.revoked,
    amendments: amendments_list,
    base_fee: resp.base_fee,
    reserve_base: resp.reserve_base,
    reserve_inc: resp.reserve_inc,
  }
}

/**
 * Finds Validator with public_key in database.
 *
 * @param public_key - Signing key for validator.
 * @returns Validator or undefined if not found.
 */
async function findInDatabase(
  public_key: string,
): Promise<ValidatorResponse | undefined> {
  const result = (await query('validators')
    .join('ballot', 'validators.signing_key', 'ballot.signing_key')
    .select([
      'validators.partial',
      'validators.unl',
      'validators.agreement_1hour',
      'validators.agreement_24hour',
      'validators.agreement_30day',
      'validators.current_index',
      'validators.domain',
      'validators.chain',
      'validators.networks',
      'validators.server_version',
      'validators.master_key',
      'validators.signing_key',
      'validators.master_key',
      'validators.revoked',
      'ballot.amendments',
      'ballot.base_fee',
      'ballot.reserve_base',
      'ballot.reserve_inc',
    ])
    .where({ master_key: public_key })
    .orWhere({ signing_key: public_key })
    .limit(1)) as dbResponse[]

  if (result.length === 0) {
    return undefined
  }

  return formatResponse(result[0])
}

void cacheValidators()

/**
 * Handles Validator Request.
 *
 * @param req - Express request.
 * @param res - Express response.
 */
export async function handleValidator(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    if (Date.now() - cache.time > CACHE_INTERVAL_MILLIS) {
      await cacheValidators()
    }

    const public_key = req.params.publicKey
    let validator: ValidatorResponse | undefined = cache.validators.find(
      (resp: ValidatorResponse) => resp.validation_public_key === public_key,
    )

    if (validator === undefined) {
      validator = await findInDatabase(public_key)
    }

    if (validator === undefined) {
      res.send({ result: 'error', message: 'validator not found' })
      return
    }

    if (validator.amendments && typeof validator.amendments === 'string') {
      validator.amendments = await formatAmendments(validator.amendments)
    }

    res.send({ ...validator, result: 'success' })
  } catch {
    res.send({ result: 'error', message: 'internal error' })
  }
}

/**
 * Handles Validators Request.
 *
 * @param req - Express request.
 * @param res - Express response.
 */
export async function handleValidators(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    if (Date.now() - cache.time > CACHE_INTERVAL_MILLIS) {
      await cacheValidators()
    }

    const { param } = req.params
    const paramType = await getParamType(param)

    let validators
    if (paramType === 'networks') {
      validators = cache.validators.filter(
        (validator) => validator.networks === param,
      )
    } else if (paramType === 'unl') {
      const chains = await getChains(param)
      validators =
        chains == null
          ? cache.validators
          : cache.validators.filter((validator) =>
              chains.includes(validator.chain),
            )
    } else {
      validators = cache.validators
    }

    const response: ValidatorsResponse = {
      result: 'success',
      count: validators.length,
      validators,
    }

    res.send(response)
  } catch {
    res.send({ result: 'error', message: 'internal error' })
  }
}
