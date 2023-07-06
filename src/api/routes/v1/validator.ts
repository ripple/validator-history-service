import { Request, Response } from 'express'

import { query } from '../../../shared/database'
import logger from '../../../shared/utils/logger'

import { formatAgreementScore, getChains } from './utils'

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
    .select([
      'partial',
      'unl',
      'agreement_1hour',
      'agreement_24hour',
      'agreement_30day',
      'current_index',
      'domain',
      'chain',
      'networks',
      'server_version',
      'master_key',
      'signing_key',
      'master_key',
      'revoked',
    ])
    .where('revoked', '=', 'false')
    .orderBy(['master_key', 'signing_key'])
    .then((res: dbResponse[]) => res.map(formatResponse))
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
    log.error(err.toString())
  }
}

/**
 * Format response to be sent back to client.
 *
 * @param resp - Database response.
 * @returns Validator in correct response format.
 */
function formatResponse(resp: dbResponse): ValidatorResponse {
  const { agreement_1hour, agreement_24hour, agreement_30day } = resp
  let hour1_score = null
  let hour24_score = null
  let day30_score = null

  if (agreement_1hour !== null) {
    hour1_score = formatAgreementScore(agreement_1hour)
  }

  if (agreement_24hour !== null) {
    hour24_score = formatAgreementScore(agreement_24hour)
  }

  if (agreement_30day !== null) {
    day30_score = formatAgreementScore(agreement_30day)
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
  const result: dbResponse[] = await query('validators')
    .select([
      'partial',
      'unl',
      'agreement_1hour',
      'agreement_24hour',
      'agreement_30day',
      'current_index',
      'domain',
      'chain',
      'server_version',
      'networks',
      'master_key',
      'signing_key',
      'master_key',
    ])
    .where({ master_key: public_key })
    .orWhere({ signing_key: public_key })
    .limit(1)

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
    if (Date.now() - cache.time > 60 * 1000) {
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
    if (Date.now() - cache.time > 60 * 1000) {
      await cacheValidators()
    }

    const { param } = req.params
    const chains = await getChains(param)
    const validators =
      chains == null
        ? cache.validators
        : cache.validators.filter((validator) =>
            chains.includes(validator.chain),
          )

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
