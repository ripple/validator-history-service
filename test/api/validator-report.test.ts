import { Request, Response } from 'express'

import handleValidatorReport from '../../src/api/routes/v1/validator-report'
import { destroy, query, setupTables } from '../../src/shared/database'

// Validator that never published a manifest, so it has no master key.
const NO_MASTER_SIGNING_KEY =
  'n9LS8sE7BCxYFJKC2eR3dFLGLRu7KYq2s88z1irdUTUkha4qWv4q'
// Validator with a manifest, so its agreement rows are keyed by master key.
const MASTER_KEY = 'nHUon2tpyJEHrb55CQ1sTYZFJvmsBvjcxfE7NLzczCmYAM7X4c1s'
const MASTER_SIGNING_KEY =
  'n9M2anhK2HzFFiJZRoGKhyLpkh55ZdeWw8YyGgvkzN7rgQEcTLPq'
// Revoked validator, which should be excluded from reports.
const REVOKED_MASTER_KEY =
  'nHBidG3pZK11zQD6kpNDoAhDxH6WLGui6ZxSbUx7LSqLHsgzMPec'
// Validator whose manifest records a master key that never made it onto its
// `validators` row, so its agreement rows are keyed by signing key.
const UNLINKED_MASTER_KEY =
  'nHBd3WLAZKmAuXX8bc99XYF7vA2VaKMznwPV1MpiZtNcZkHekUPT'
const UNLINKED_SIGNING_KEY =
  'n9L996F3HA2t8jL4WhRfkaj55zXJmYnQsAiqoPPCu1WjrYy8C6wm'

const DAY = new Date('2026-09-01T00:00:00.000Z')

const validators = [
  {
    master_key: null,
    signing_key: NO_MASTER_SIGNING_KEY,
    revoked: false,
    chain: 'main',
    networks: 'main',
  },
  {
    master_key: MASTER_KEY,
    signing_key: MASTER_SIGNING_KEY,
    revoked: false,
    chain: 'main',
    networks: 'main',
  },
  {
    master_key: REVOKED_MASTER_KEY,
    signing_key: 'n9KaxgJv69FucW5kkiaMhCqS6sAR1wUVxpZaZmLGVXxAcAse9YhR',
    revoked: true,
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
]

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

// saveDailyAgreement keys rows by `master_key ?? signing_key`.
const dailyAgreements = [
  {
    main_key: NO_MASTER_SIGNING_KEY,
    day: DAY,
    agreement: JSON.stringify({ validated: 90, missed: 10, incomplete: false }),
  },
  {
    main_key: MASTER_KEY,
    day: DAY,
    agreement: JSON.stringify({ validated: 75, missed: 25, incomplete: false }),
  },
  {
    main_key: REVOKED_MASTER_KEY,
    day: DAY,
    agreement: JSON.stringify({ validated: 50, missed: 50, incomplete: false }),
  },
  // Written under the signing key, because validators.master_key is null.
  {
    main_key: UNLINKED_SIGNING_KEY,
    day: DAY,
    agreement: JSON.stringify({ validated: 60, missed: 40, incomplete: false }),
  },
]

interface ReportsBody {
  count: number
  reports: Array<{ validation_public_key: string; score: string }>
}

/**
 * Invokes the reports handler and returns what it sent.
 *
 * @param publicKey - Key to request reports for.
 * @returns The response body passed to res.send.
 */
async function getReportsFor(publicKey: string): Promise<ReportsBody> {
  const req = { params: { publicKey } } as unknown as Request
  const send = jest.fn<undefined, [ReportsBody]>()
  const res = {
    send,
    status: jest.fn().mockReturnThis(),
  } as unknown as Response

  await handleValidatorReport(req, res)

  return send.mock.calls[0][0]
}

describe('tests for validator reports endpoint', () => {
  beforeAll(async () => {
    await setupTables()
    await query('validators').delete('*')
    await query('daily_agreement').delete('*')
    await query('manifests').delete('*')
    await query('validators').insert(validators)
    await query('daily_agreement').insert(dailyAgreements)
    await query('manifests').insert(manifests)
  })

  afterAll(async () => {
    await query('validators').delete('*')
    await query('daily_agreement').delete('*')
    await query('manifests').delete('*')
    await destroy()
  })

  it('returns reports for a validator with no master key, by signing key', async () => {
    const body = await getReportsFor(NO_MASTER_SIGNING_KEY)

    expect(body.count).toBe(1)
    expect(body.reports[0].validation_public_key).toBe(NO_MASTER_SIGNING_KEY)
    expect(body.reports[0].score).toBe('0.90000')
  })

  it('returns reports for a validator looked up by its master key', async () => {
    const body = await getReportsFor(MASTER_KEY)

    expect(body.count).toBe(1)
    expect(body.reports[0].validation_public_key).toBe(MASTER_KEY)
    expect(body.reports[0].score).toBe('0.75000')
  })

  it('returns reports for a validator looked up by its signing key', async () => {
    const body = await getReportsFor(MASTER_SIGNING_KEY)

    expect(body.count).toBe(1)
    expect(body.reports[0].validation_public_key).toBe(MASTER_KEY)
    expect(body.reports[0].score).toBe('0.75000')
  })

  it('excludes revoked validators', async () => {
    const body = await getReportsFor(REVOKED_MASTER_KEY)

    expect(body.count).toBe(0)
  })

  it('finds a validator by master key when only its manifest records it', async () => {
    const body = await getReportsFor(UNLINKED_MASTER_KEY)

    expect(body.count).toBe(1)
    expect(body.reports[0].score).toBe('0.60000')
  })

  it('reports the manifest master key as the canonical public key', async () => {
    const bySigning = await getReportsFor(UNLINKED_SIGNING_KEY)
    const byMaster = await getReportsFor(UNLINKED_MASTER_KEY)

    expect(bySigning.reports[0].validation_public_key).toBe(UNLINKED_MASTER_KEY)
    expect(byMaster.reports[0].validation_public_key).toBe(UNLINKED_MASTER_KEY)
  })

  it('returns no reports for an unknown key', async () => {
    const body = await getReportsFor('n9UnknownKeyThatDoesNotExistAnywhere')

    expect(body.count).toBe(0)
  })
})
