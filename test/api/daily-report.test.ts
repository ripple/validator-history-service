import { Request, Response } from 'express'

import handleDailyScores from '../../src/api/routes/v1/daily-report'
import { CACHE_INTERVAL_MILLIS } from '../../src/api/routes/v1/utils'
import { destroy, query, setupTables } from '../../src/shared/database'

// Validator that never published a manifest, so it has no master key.
const NO_MASTER_SIGNING_KEY =
  'n9LS8sE7BCxYFJKC2eR3dFLGLRu7KYq2s88z1irdUTUkha4qWv4q'
// Validator with a manifest, so its agreement rows are keyed by master key.
const MASTER_KEY = 'nHUon2tpyJEHrb55CQ1sTYZFJvmsBvjcxfE7NLzczCmYAM7X4c1s'
// Validator whose only day so far has no validated and no missed ledgers.
const ZERO_TOTAL_MASTER_KEY =
  'nHBidG3pZK11zQD6kpNDoAhDxH6WLGui6ZxSbUx7LSqLHsgzMPec'

const TODAY = new Date()
TODAY.setHours(0, 0, 0, 0)

const YESTERDAY = new Date(TODAY)
YESTERDAY.setDate(YESTERDAY.getDate() - 1)

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
    signing_key: 'n9M2anhK2HzFFiJZRoGKhyLpkh55ZdeWw8YyGgvkzN7rgQEcTLPq',
    revoked: false,
    chain: 'main',
    networks: 'main',
  },
  {
    master_key: ZERO_TOTAL_MASTER_KEY,
    signing_key: 'n9KaxgJv69FucW5kkiaMhCqS6sAR1wUVxpZaZmLGVXxAcAse9YhR',
    revoked: false,
    chain: 'main',
    networks: 'main',
  },
]

// saveDailyAgreement keys rows by `master_key ?? signing_key`.
const dailyAgreements = [
  {
    main_key: NO_MASTER_SIGNING_KEY,
    day: TODAY,
    agreement: JSON.stringify({ validated: 90, missed: 10, incomplete: false }),
  },
  {
    main_key: MASTER_KEY,
    day: TODAY,
    agreement: JSON.stringify({ validated: 75, missed: 25, incomplete: false }),
  },
  {
    main_key: ZERO_TOTAL_MASTER_KEY,
    day: TODAY,
    agreement: JSON.stringify({ validated: 0, missed: 0, incomplete: false }),
  },
  // A prior day, which today's report must not include.
  {
    main_key: MASTER_KEY,
    day: YESTERDAY,
    agreement: JSON.stringify({ validated: 10, missed: 90, incomplete: false }),
  },
]

interface ReportsBody {
  count: number
  reports: Array<{ validation_public_key: string; score: string }>
}

// The endpoint caches for CACHE_INTERVAL_MILLIS and primes that cache at import
// time, before this suite seeds the database. Advancing the clock past the
// interval on every call forces each request to re-query.
let clockOffsetMillis = 0

/**
 * Invokes the daily scores handler and returns what it sent.
 *
 * @returns The response body passed to res.send.
 */
async function getDailyReport(): Promise<ReportsBody> {
  clockOffsetMillis += 10 * CACHE_INTERVAL_MILLIS
  const realNow = Date.now.bind(Date)
  const nowSpy = jest
    .spyOn(Date, 'now')
    .mockImplementation(() => realNow() + clockOffsetMillis)

  const send = jest.fn<undefined, [ReportsBody]>()
  const res = {
    send,
    status: jest.fn().mockReturnThis(),
  } as unknown as Response

  try {
    await handleDailyScores({} as Request, res)
  } finally {
    nowSpy.mockRestore()
  }

  return send.mock.calls[0][0]
}

describe('tests for daily report endpoint', () => {
  beforeAll(async () => {
    await setupTables()
    await query('validators').delete('*')
    await query('daily_agreement').delete('*')
    await query('validators').insert(validators)
    await query('daily_agreement').insert(dailyAgreements)
  })

  afterAll(async () => {
    await query('validators').delete('*')
    await query('daily_agreement').delete('*')
    await destroy()
  })

  it('includes validators without a master key', async () => {
    const { reports } = await getDailyReport()
    const keys = reports.map((report) => report.validation_public_key)

    expect(keys).toContain(NO_MASTER_SIGNING_KEY)
  })

  it('still includes validators with a master key', async () => {
    const { reports } = await getDailyReport()
    const report = reports.find(
      (entry) => entry.validation_public_key === MASTER_KEY,
    )

    expect(report?.score).toBe('0.75000')
  })

  it('reports only today, one row per validator', async () => {
    const { count, reports } = await getDailyReport()

    expect(count).toBe(3)
    expect(reports).toHaveLength(3)
  })

  it('scores a day with no validated and no missed ledgers as zero', async () => {
    const { reports } = await getDailyReport()
    const report = reports.find(
      (entry) => entry.validation_public_key === ZERO_TOTAL_MASTER_KEY,
    )

    expect(report?.score).toBe('0.00000')
  })
})
