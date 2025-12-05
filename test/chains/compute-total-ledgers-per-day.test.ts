import agreement from '../../src/connection-manager/agreement'
import { destroy, query, setupTables } from '../../src/shared/database'
import {
  DailyAgreement,
  HourlyAgreement,
  ValidationRaw,
} from '../../src/shared/types'

describe('Compute Total Ledgers Per Day', () => {
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
  })

  afterEach(async () => {
    await query('hourly_agreement').delete('*')
    await query('daily_agreement').delete('*')
    await query('manifests').delete('*')
  })

  test('validate the contents of DB after one day of validations', async () => {
    // Note: This test simulates one entire day of validations, it needs more time to run.
    jest.setTimeout(20_000)
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
      network_id: 1027,
    } as ValidationRaw
    const TOTAL_LEDGERS_PER_HOUR = 900
    let LATEST_LEDGER_INDEX = 0

    for (let hourIndex = 0; hourIndex < 24; hourIndex++) {
      for (let i = 0; i < TOTAL_LEDGERS_PER_HOUR; i++) {
        sampleValidation.ledger_index = (LATEST_LEDGER_INDEX + 1).toString()
        sampleValidation.ledger_hash = `LEDGER${LATEST_LEDGER_INDEX + 1}`
        sampleValidation.master_key = `VALIDATOR1MASTER`
        sampleValidation.validation_public_key = `VALIDATOR1`
        await agreement.handleValidation(sampleValidation)

        sampleValidation.master_key = `VALIDATOR2MASTER`
        sampleValidation.validation_public_key = `VALIDATOR2`
        await agreement.handleValidation(sampleValidation)

        LATEST_LEDGER_INDEX += 1
      }

      // Agreement is computed every hour. The logic in chains considers only ledgers which are at least 10 seconds old.
      const time = Date.now() + 3600 * 1000 + 15 * 1000

      // Mock date.now
      Date.now = (): number => time
      await agreement.calculateAgreement()

      const hourly_agreement = (await query('hourly_agreement').select(
        '*',
      )) as HourlyAgreement[]

      const hourly_master_keys = hourly_agreement.map(
        (member) => member.main_key,
      )
      expect(hourly_master_keys).toContain('VALIDATOR1MASTER')
      expect(hourly_master_keys).toContain('VALIDATOR2MASTER')

      expect(hourly_agreement).toHaveLength(2 * (hourIndex + 1))

      const daily_agreement = (await query('daily_agreement').select(
        '*',
      )) as DailyAgreement[]

      const daily_master_keys = daily_agreement.map((member) => member.main_key)
      expect(daily_master_keys).toContain('VALIDATOR1MASTER')
      expect(daily_master_keys).toContain('VALIDATOR2MASTER')

      expect(daily_agreement).toHaveLength(2)
      for (let i = 0; i < 2; i++) {
        expect(daily_agreement[i].agreement.validated).toBe(LATEST_LEDGER_INDEX)
        expect(daily_agreement[i].agreement.missed).toBe(0)
        expect(daily_agreement[i].agreement.incomplete).toBe(true)
      }
    }

    expect(LATEST_LEDGER_INDEX).toBe(TOTAL_LEDGERS_PER_HOUR * 24)
  })
})
