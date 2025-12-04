import agreement from '../../src/connection-manager/agreement'
import { destroy, query, setupTables } from '../../src/shared/database'
import {
  DailyAgreement,
  HourlyAgreement,
  ValidationRaw,
} from '../../src/shared/types'

describe('Compute Total Ledgers Per Hour', () => {
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

  test('compute the total ledgers processed every hour', async () => {
    const sampleValidation = {
      flags: 2147483649,
      full: true,
      ledger_hash: 'LEDGER1',
      ledger_index: '1',
      master_key: 'VALIDATOR1MASTER',
      signature:
        '30440220342DFBFBA1ACF758805A1CD5FF0C4E39F0A2800D0400F430A22BEBDB2B9E327A02204776C0E90942FB9CACDB763535AFAADBA1506E94CD92A605296153D8362D01E3',
      signing_time: 669928656,
      type: 'validationReceived',
      validation_public_key: 'VALIDATOR1',
      network_id: 1025,
    } as ValidationRaw

    const TOTAL_LEDGERS_PER_HOUR = 900
    for (let i = 0; i < TOTAL_LEDGERS_PER_HOUR; i++) {
      sampleValidation.ledger_index = (i + 1).toString()
      sampleValidation.ledger_hash = `LEDGER${i + 1}`
      sampleValidation.master_key = `VALIDATOR1MASTER`
      sampleValidation.validation_public_key = `VALIDATOR1`
      await agreement.handleValidation(sampleValidation)

      sampleValidation.master_key = `VALIDATOR2MASTER`
      sampleValidation.validation_public_key = `VALIDATOR2`
      await agreement.handleValidation(sampleValidation)
    }

    const time = Date.now() + 11000

    // Mock date.now
    Date.now = (): number => time
    await agreement.calculateAgreement()

    const hourly_agreement = (await query('hourly_agreement').select(
      '*',
    )) as HourlyAgreement[]
    const daily_agreement = (await query('daily_agreement').select(
      '*',
    )) as DailyAgreement[]

    const hourly_master_keys = hourly_agreement.map((member) => member.main_key)
    expect(hourly_master_keys).toContain('VALIDATOR1MASTER')
    expect(hourly_master_keys).toContain('VALIDATOR2MASTER')

    const daily_master_keys = daily_agreement.map((member) => member.main_key)
    expect(daily_master_keys).toContain('VALIDATOR1MASTER')
    expect(daily_master_keys).toContain('VALIDATOR2MASTER')

    expect(hourly_agreement).toHaveLength(2)
    for (let i = 0; i < 2; i++) {
      expect(hourly_agreement[i].agreement.validated).toBe(
        TOTAL_LEDGERS_PER_HOUR,
      )
      expect(hourly_agreement[i].agreement.missed).toBe(0)
      expect(hourly_agreement[i].agreement.incomplete).toBe(true)
    }

    expect(daily_agreement).toHaveLength(2)
    for (let i = 0; i < 2; i++) {
      expect(daily_agreement[i].agreement.validated).toBe(
        TOTAL_LEDGERS_PER_HOUR,
      )
      expect(daily_agreement[i].agreement.missed).toBe(0)
      expect(daily_agreement[i].agreement.incomplete).toBe(true)
    }
  })
})
