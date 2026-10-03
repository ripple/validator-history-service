import agreement from '../../src/connection-manager/agreement'
import { destroy, query, setupTables } from '../../src/shared/database'
import {
  AgreementScore,
  HourlyAgreement,
  ValidationRaw,
} from '../../src/shared/types'

/**
 * Read by the mocked getAgreementScores. The factory closes over this object;
 * flipping `fail` rejects the rollup the way a saturated Knex pool does.
 */
const scoreGate = {
  fail: false,
}

jest.mock('../../src/shared/database', () => {
  const actual = jest.requireActual<typeof import('../../src/shared/database')>(
    '../../src/shared/database',
  )
  return {
    ...actual,
    async getAgreementScores(
      ...args: Parameters<typeof actual.getAgreementScores>
    ): Promise<AgreementScore> {
      if (scoreGate.fail) {
        throw new Error(
          'KnexTimeoutError: Timeout acquiring a connection. The pool is probably full.',
        )
      }
      return actual.getAgreementScores(...args)
    },
  }
})

const SIGNING_A = 'n9WindowTestA'
const SIGNING_B = 'n9WindowTestB'
const MASTER_A = 'nHWindowTestA'
const MASTER_B = 'nHWindowTestB'

function raw(
  signingKey: string,
  masterKey: string,
  index: number,
): ValidationRaw {
  return {
    flags: 0x80000000,
    full: true,
    ledger_hash: `LEDGER_${index}`,
    ledger_index: String(index),
    master_key: masterKey,
    signature: 'sig',
    signing_time: 0,
    type: 'validationReceived',
    validation_public_key: signingKey,
  }
}

async function feed(index: number): Promise<void> {
  await agreement.handleValidation(raw(SIGNING_A, MASTER_A, index))
  await agreement.handleValidation(raw(SIGNING_B, MASTER_B, index))
}

function ledgerCount(score: AgreementScore): number {
  return score.validated + score.missed
}

describe('agreement window reset', () => {
  const realNow = Date.now.bind(Date)

  beforeAll(async () => {
    await setupTables()
  })

  afterAll(async () => {
    Date.now = realNow
    scoreGate.fail = false
    await destroy()
  })

  beforeEach(async () => {
    Date.now = realNow
    scoreGate.fail = false
    await query('hourly_agreement').delete('*')
    await query('daily_agreement').delete('*')
    await query('validators').delete('*')
  })

  test('a score-write failure still closes the chain window', async () => {
    await feed(1000)
    await feed(1001)
    await feed(1002)

    Date.now = (): number => realNow() + 11_000
    scoreGate.fail = true
    await expect(agreement.calculateAgreement()).resolves.toBeUndefined()
    scoreGate.fail = false
    Date.now = realNow

    await feed(1003)

    Date.now = (): number => realNow() + 11_000
    await agreement.calculateAgreement()
    Date.now = realNow

    const rows = (await query('hourly_agreement')
      .select('*')
      .whereIn('main_key', [MASTER_A, MASTER_B])
      .orderBy('start', 'desc')) as HourlyAgreement[]

    const latest = new Map<string, HourlyAgreement>()
    for (const row of rows) {
      if (!latest.has(row.main_key)) {
        latest.set(row.main_key, row)
      }
    }

    expect(latest.size).toBe(2)
    for (const row of latest.values()) {
      // The failed run had already accumulated ledgers 1000-1002. If the
      // chain was not purged, this bucket would also contain those three.
      expect(ledgerCount(row.agreement)).toBe(1)
    }
  })
})
