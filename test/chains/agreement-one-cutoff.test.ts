// One hourly run scores every validator against the same 24 hour and 30 day
// window. The rows of one batch all carry start = reported_at, so 24 hours
// later the window's lower edge reaches that batch while the run is still
// scoring validators. If each validator took its own `new Date()` as the end
// of its window, validators scored before the edge passed would count the
// batch and validators scored after it would not, and the same run would
// publish 24 hour totals that differ by one whole batch.

import agreement from '../../src/connection-manager/agreement'
import * as database from '../../src/shared/database'
import { destroy, query, setupTables } from '../../src/shared/database'

import validations from './fixtures/all-validations.json'

const HOUR = 60 * 60 * 1000
const MAIN_KEYS = ['VALIDATOR1MASTER', 'VALIDATOR2MASTER', 'VALIDATOR3MASTER']

describe('Agreement window cutoff', () => {
  beforeAll(async () => {
    await setupTables()
  })

  afterAll(async () => {
    await destroy()
  })

  beforeEach(async () => {
    await query('hourly_agreement').delete('*')
    await query('daily_agreement').delete('*')
    await query('manifests').delete('*')
    await query('validators').delete('*')
    jest.useFakeTimers()
  })

  afterEach(async () => {
    jest.useRealTimers()
    jest.restoreAllMocks()
    await query('hourly_agreement').delete('*')
    await query('daily_agreement').delete('*')
    await query('manifests').delete('*')
    await query('validators').delete('*')
  })

  test('every validator in one run is scored over the same 24 hour window', async () => {
    for (const validation of validations) {
      await agreement.handleValidation(validation)
    }

    const runStart = Date.now() + 11000
    jest.setSystemTime(runStart)

    // A batch saved 23.5 hours before this run: inside its 24 hour window.
    const boundary = new Date(runStart - 24 * HOUR + HOUR / 2)
    for (const main_key of MAIN_KEYS) {
      await query('hourly_agreement').insert({
        main_key,
        start: boundary,
        agreement: { validated: 800, missed: 44, incomplete: false },
      })
    }

    // The run takes time. A validator takes its window's end and starts its
    // 24 hour query in one synchronous step, so the first query marks the
    // first validator scored: move the clock past the boundary batch's
    // 24 hour mark there, as a run of many validators does.
    const getScores = database.getAgreementScores
    let queries = 0
    jest
      .spyOn(database, 'getAgreementScores')
      .mockImplementation(async (keys, start, end) => {
        queries += 1
        if (queries === 1) {
          jest.setSystemTime(runStart + HOUR)
        }
        return getScores(keys, start, end)
      })

    await agreement.calculateAgreement()

    const rows = (await query('validators')
      .select('master_key', 'agreement_24hour')
      .whereIn('master_key', MAIN_KEYS)
      .orderBy('master_key')) as Array<{
      master_key: string
      agreement_24hour: { validated: number; missed: number }
    }>

    // The boundary batch (800 validated, 44 missed) counts for all three.
    expect(rows.map((row) => row.agreement_24hour.missed)).toEqual([44, 44, 44])
    const totals = rows.map(
      (row) => row.agreement_24hour.validated + row.agreement_24hour.missed,
    )
    expect(new Set(totals).size).toBe(1)
  })
})
