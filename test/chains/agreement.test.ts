import agreement from '../../src/connection-manager/agreement'
import { destroy, query, setupTable } from '../../src/shared/database'

import validations from './fixtures/all-validations.json'

async function insertManifests(): Promise<void> {
  await query('manifests').insert({
    master_key: 'VALIDATOR1MASTER',
    signing_key: 'VALIDATOR1',
  })
  await query('manifests').insert({
    master_key: 'VALIDATOR2MASTER',
    signing_key: 'VALIDATOR2',
  })
  await query('manifests').insert({
    master_key: 'VALIDATOR3MASTER',
    signing_key: 'VALIDATOR3',
  })
}

describe('Agreement', () => {
  beforeAll(async () => {
    await setupTable()
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

  test('Does not calculate score without master_key', async () => {
    for (const validation of validations) {
      // eslint-disable-next-line no-await-in-loop -- necessary await
      await agreement.handleValidation(validation)
    }

    const time = Date.now() + 11000

    // Mock date.now
    Date.now = (): number => time
    await agreement.calculateAgreement()

    const hourly_agreement = await query('hourly_agreement').select('*')
    const daily_agreement = await query('daily_agreement').select('*')

    expect(hourly_agreement).toEqual([])
    expect(daily_agreement).toEqual([])
  })

  test('Correctly computes daily agreement', async () => {
    await insertManifests()

    for (const validation of validations) {
      // eslint-disable-next-line no-await-in-loop -- necessary await
      await agreement.handleValidation(validation)
    }

    const time = Date.now() + 11000

    // Mock date.now
    Date.now = (): number => time
    await agreement.calculateAgreement()

    const hourly_agreement: Array<{ master_key: string }> = await query(
      'hourly_agreement',
    ).select('*')
    const daily_agreement: Array<{ master_key: string }> = await query(
      'daily_agreement',
    ).select('*')

    const hourly_master_keys = hourly_agreement.map(
      (member) => member.master_key,
    )
    expect(hourly_master_keys).toContain('VALIDATOR1MASTER')
    expect(hourly_master_keys).toContain('VALIDATOR2MASTER')
    expect(hourly_master_keys).toContain('VALIDATOR3MASTER')

    const daily_master_keys = daily_agreement.map((member) => member.master_key)
    expect(daily_master_keys).toContain('VALIDATOR1MASTER')
    expect(daily_master_keys).toContain('VALIDATOR2MASTER')
    expect(daily_master_keys).toContain('VALIDATOR3MASTER')
  })
})
