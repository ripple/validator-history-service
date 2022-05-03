import agreement from '../../src/connection-manager/agreement'
import { destroy, query, setupTables } from '../../src/shared/database'

import validations from './fixtures/all-validations.json'

describe('Agreement', () => {
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

  test('Correctly computes hourly + daily agreement', async () => {
    for (const validation of validations) {
      await agreement.handleValidation(validation)
    }

    const time = Date.now() + 11000

    // Mock date.now
    Date.now = (): number => time
    await agreement.calculateAgreement()

    const hourly_agreement: Array<{ main_key: string }> = await query(
      'hourly_agreement',
    ).select('*')
    const daily_agreement: Array<{ main_key: string }> = await query(
      'daily_agreement',
    ).select('*')

    const hourly_master_keys = hourly_agreement.map((member) => member.main_key)
    expect(hourly_master_keys).toContain('VALIDATOR1MASTER')
    expect(hourly_master_keys).toContain('VALIDATOR2MASTER')
    expect(hourly_master_keys).toContain('VALIDATOR3MASTER')

    const daily_master_keys = daily_agreement.map((member) => member.main_key)
    expect(daily_master_keys).toContain('VALIDATOR1MASTER')
    expect(daily_master_keys).toContain('VALIDATOR2MASTER')
    expect(daily_master_keys).toContain('VALIDATOR3MASTER')
  })
})
