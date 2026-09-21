import { Request, Response } from 'express'

import { CACHE_INTERVAL_MILLIS } from '../../src/api/routes/v1/utils'
import { handleValidator } from '../../src/api/routes/v1/validator'
import { destroy, query, setupTables } from '../../src/shared/database'

// Validator whose `validators` row carries its master key.
const LINKED_MASTER_KEY = 'nHUon2tpyJEHrb55CQ1sTYZFJvmsBvjcxfE7NLzczCmYAM7X4c1s'
const LINKED_SIGNING_KEY =
  'n9M2anhK2HzFFiJZRoGKhyLpkh55ZdeWw8YyGgvkzN7rgQEcTLPq'
// Validator whose master key is only recorded in `manifests`.
const UNLINKED_MASTER_KEY =
  'nHBd3WLAZKmAuXX8bc99XYF7vA2VaKMznwPV1MpiZtNcZkHekUPT'
const UNLINKED_SIGNING_KEY =
  'n9L996F3HA2t8jL4WhRfkaj55zXJmYnQsAiqoPPCu1WjrYy8C6wm'
// Validator with no manifest at all, so it genuinely has no master key.
const NO_MASTER_SIGNING_KEY =
  'n9LS8sE7BCxYFJKC2eR3dFLGLRu7KYq2s88z1irdUTUkha4qWv4q'
// Validator that has not reached a flag ledger yet, so it has no ballot row.
const NO_BALLOT_SIGNING_KEY =
  'n9KaxgJv69FucW5kkiaMhCqS6sAR1wUVxpZaZmLGVXxAcAse9YhR'

const validators = [
  {
    master_key: LINKED_MASTER_KEY,
    signing_key: LINKED_SIGNING_KEY,
    revoked: false,
    chain: 'main',
    networks: 'main',
  },
  {
    master_key: null,
    signing_key: UNLINKED_SIGNING_KEY,
    revoked: false,
    chain: 'main',
    networks: 'main',
  },
  {
    master_key: null,
    signing_key: NO_MASTER_SIGNING_KEY,
    revoked: false,
    chain: 'main',
    networks: 'main',
  },
  {
    master_key: null,
    signing_key: NO_BALLOT_SIGNING_KEY,
    revoked: false,
    chain: 'main',
    networks: 'main',
  },
]

// Every validator except NO_BALLOT_SIGNING_KEY has voted at a flag ledger.
const ballots = validators
  .filter((validator) => validator.signing_key !== NO_BALLOT_SIGNING_KEY)
  .map((validator) => ({
    signing_key: validator.signing_key,
    ledger_index: 1,
    base_fee: 10,
  }))

const manifests = [
  {
    master_key: UNLINKED_MASTER_KEY,
    signing_key: UNLINKED_SIGNING_KEY,
    master_signature: 'E2AC88F1',
    signature: '3045022100',
    domain: 'trimaera.tech',
    domain_verified: true,
    revoked: false,
    seq: 2,
  },
]

interface ValidatorBody {
  result: string
  message?: string
  validation_public_key?: string
  master_key?: string | null
  signing_key?: string
  base_fee?: number
  amendments?: Array<{ id: string; name: string }>
}

// handleValidator caches for CACHE_INTERVAL_MILLIS and primes that cache at
// import time, before this suite seeds the database. Advancing the clock past
// the interval forces a re-query.
let clockOffsetMillis = 0

/**
 * Invokes the validator handler and returns the status and body it sent.
 *
 * @param publicKey - Key to look up.
 * @returns The status code and response body.
 */
async function getValidator(
  publicKey: string,
): Promise<{ status: number; body: ValidatorBody }> {
  clockOffsetMillis += 10 * CACHE_INTERVAL_MILLIS
  const realNow = Date.now.bind(Date)
  const nowSpy = jest
    .spyOn(Date, 'now')
    .mockImplementation(() => realNow() + clockOffsetMillis)

  const send = jest.fn<undefined, [ValidatorBody]>()
  const status = jest.fn<Response, [number]>().mockReturnThis()
  const res = { send, status } as unknown as Response

  try {
    await handleValidator({ params: { publicKey } } as unknown as Request, res)
  } finally {
    nowSpy.mockRestore()
  }

  return {
    status: status.mock.calls[0][0],
    body: send.mock.calls[0][0],
  }
}

describe('tests for validator endpoint key resolution', () => {
  beforeAll(async () => {
    await setupTables()
    await query('validators').delete('*')
    await query('ballot').delete('*')
    await query('manifests').delete('*')
    await query('validators').insert(validators)
    await query('ballot').insert(ballots)
    await query('manifests').insert(manifests)
  })

  afterAll(async () => {
    await query('validators').delete('*')
    await query('ballot').delete('*')
    await query('manifests').delete('*')
    await destroy()
  })

  it('reports the master key recorded in manifests', async () => {
    const { status, body } = await getValidator(UNLINKED_SIGNING_KEY)

    expect(status).toBe(200)
    expect(body.master_key).toBe(UNLINKED_MASTER_KEY)
    expect(body.validation_public_key).toBe(UNLINKED_MASTER_KEY)
    expect(body.signing_key).toBe(UNLINKED_SIGNING_KEY)
  })

  it('finds that validator by its master key too', async () => {
    const { status, body } = await getValidator(UNLINKED_MASTER_KEY)

    expect(status).toBe(200)
    expect(body.master_key).toBe(UNLINKED_MASTER_KEY)
  })

  it('leaves master_key null when no manifest exists', async () => {
    const { status, body } = await getValidator(NO_MASTER_SIGNING_KEY)

    expect(status).toBe(200)
    expect(body.master_key).toBeNull()
    expect(body.validation_public_key).toBe(NO_MASTER_SIGNING_KEY)
  })

  it('still resolves a validator whose row carries its master key', async () => {
    const byMaster = await getValidator(LINKED_MASTER_KEY)
    const bySigning = await getValidator(LINKED_SIGNING_KEY)

    expect(byMaster.body.master_key).toBe(LINKED_MASTER_KEY)
    expect(bySigning.body.master_key).toBe(LINKED_MASTER_KEY)
  })

  it('returns a validator that has no ballot row yet', async () => {
    const { status, body } = await getValidator(NO_BALLOT_SIGNING_KEY)

    expect(status).toBe(200)
    expect(body.validation_public_key).toBe(NO_BALLOT_SIGNING_KEY)
  })

  it('omits ballot fields when the validator has no ballot row', async () => {
    const { body } = await getValidator(NO_BALLOT_SIGNING_KEY)

    expect(body).not.toHaveProperty('base_fee', null)
    expect(body.base_fee).toBeUndefined()
    expect(body.amendments).toBeUndefined()
  })

  it('still returns ballot fields when the validator has voted', async () => {
    const { body } = await getValidator(LINKED_MASTER_KEY)

    expect(body.base_fee).toBe(10)
  })

  it('returns 404 rather than a SQL error for an unknown key', async () => {
    const { status, body } = await getValidator('n9UnknownKeyNotInDatabase')

    expect(status).toBe(404)
    expect(body.message).toBe('validator not found')
  })
})
