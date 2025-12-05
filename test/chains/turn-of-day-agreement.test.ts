// set the time to be 2320 hours on an arbitrary dateat the UTC timezone.
// the time needs to be set before the construction of agreement object.
jest.useFakeTimers('modern')
const agreementComputationStartTime = new Date('2025-01-01T16:20:00.000Z')
jest.setSystemTime(agreementComputationStartTime)

import agreement from '../../src/connection-manager/agreement'
import chains from '../../src/connection-manager/chains'
import { destroy, query, setupTables } from '../../src/shared/database'
import { DailyAgreement, ValidationRaw } from '../../src/shared/types'

describe('Turn of the Day Agreement', () => {
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
    await chains.purgeChains()
  })

  afterEach(async () => {
    await query('hourly_agreement').delete('*')
    await query('daily_agreement').delete('*')
    await query('manifests').delete('*')
    jest.useRealTimers()
  })

  test('validate contents of daily_agreement table at turn of the day', async () => {
    const sampleValidation = {
      type: 'validationReceived',
      // the below four fields differ for each validation
      ledger_hash: 'LEDGER1',
      ledger_index: '1',
      master_key: 'VALIDATOR1MASTER',
      validation_public_key: 'VALIDATOR1',
      // the below fields are not pertinent to below test
      flags: 2147483649,
      full: true,
      signature:
        '30440220342DFBFBA1ACF758805A1CD5FF0C4E39F0A2800D0400F430A22BEBDB2B9E327A02204776C0E90942FB9CACDB763535AFAADBA1506E94CD92A605296153D8362D01E3',
      signing_time: 669928656,
      network_id: 1026,
    } as ValidationRaw

    const TOTAL_VALIDATORS = 2
    const TOTAL_LEDGERS = 3

    // The below value is used to validate the correctness of the daily_agreement table.
    const startOfCurrentDay = new Date(2025, 0, 1, 0, 0, 0, 0)
    for (let i = 0; i < TOTAL_LEDGERS; i++) {
      sampleValidation.ledger_index = (i + 1).toString()
      sampleValidation.ledger_hash = `LEDGER${i + 1}`
      sampleValidation.master_key = `VALIDATOR4MASTER`
      sampleValidation.validation_public_key = `VALIDATOR4`
      await agreement.handleValidation(sampleValidation)

      sampleValidation.master_key = `VALIDATOR5MASTER`
      sampleValidation.validation_public_key = `VALIDATOR5`
      await agreement.handleValidation(sampleValidation)
    }

    // Move the clock by at least 1 hour and 15 seconds. Time is now at 00:20:15 on the next day (UTC time).
    jest.advanceTimersByTime(3600 * 1000 + 15 * 1000)
    await agreement.calculateAgreement()

    // validate that the next day does not have any daily_agreement record, although the timestamp is 0020 hours in the next day.
    const nextDay = new Date(startOfCurrentDay)
    nextDay.setDate(nextDay.getDate() + 1)
    const daily_agreement_next_day = (await query('daily_agreement')
      .select('*')
      .where('day', '=', nextDay)) as DailyAgreement[]
    expect(daily_agreement_next_day).toHaveLength(0)

    // validate the contents of the daily_agreement table.
    // Note: This table is queried for the previous day's records.
    const daily_agreement = (await query('daily_agreement')
      .select('*')
      .where('day', '<', nextDay)) as DailyAgreement[]

    const daily_master_keys = daily_agreement.map((member) => member.main_key)
    expect(daily_master_keys).toContain('VALIDATOR4MASTER')
    expect(daily_master_keys).toContain('VALIDATOR5MASTER')

    expect(daily_agreement).toHaveLength(TOTAL_VALIDATORS)
    for (let i = 0; i < TOTAL_VALIDATORS; i++) {
      expect(daily_agreement[i].agreement.validated).toBe(TOTAL_LEDGERS)
      expect(daily_agreement[i].agreement.missed).toBe(0)
      expect(daily_agreement[i].agreement.incomplete).toBe(true)
    }
  })
})
