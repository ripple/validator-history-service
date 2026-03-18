import agreement from '../../src/connection-manager/agreement'
import {
  decodeServerVersion,
  destroy,
  query,
  setupTables,
} from '../../src/shared/database'
import { DailyAgreement, HourlyAgreement } from '../../src/shared/types'

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

    const hourly_agreement = (await query('hourly_agreement').select(
      '*',
    )) as HourlyAgreement[]
    const daily_agreement = (await query('daily_agreement').select(
      '*',
    )) as DailyAgreement[]

    const hourly_master_keys = hourly_agreement.map((member) => member.main_key)
    expect(hourly_master_keys).toContain('VALIDATOR1MASTER')
    expect(hourly_master_keys).toContain('VALIDATOR2MASTER')
    expect(hourly_master_keys).toContain('VALIDATOR3MASTER')

    const daily_master_keys = daily_agreement.map((member) => member.main_key)
    expect(daily_master_keys).toContain('VALIDATOR1MASTER')
    expect(daily_master_keys).toContain('VALIDATOR2MASTER')
    expect(daily_master_keys).toContain('VALIDATOR3MASTER')
  })

  test('Correctly decode server version for validators', () => {
    const correctBasicVersion = decodeServerVersion('1745990418748669952')
    const correctRCVersion = decodeServerVersion('1745990418744934400')
    const correctBetaVersion = decodeServerVersion('1745990418740740096')
    expect(correctBasicVersion).toBe('1.9.2')
    expect(correctRCVersion).toBe('1.9.2-rc7')
    expect(correctBetaVersion).toBe('1.9.2-b7')
  })

  test('Returns null if server version implementation identifier is invalid', () => {
    const incorrectVersionFirst8B = decodeServerVersion('1673932824710742016')
    const incorrectVersionNext8B = decodeServerVersion('1735857319587086336')
    expect(incorrectVersionFirst8B).toBe(null)
    expect(incorrectVersionNext8B).toBe(null)
  })

  test('Returns null if release type bits is not either 10, 01 or 11', () => {
    const incorrectVersionType = decodeServerVersion('1745990418736087040')
    expect(incorrectVersionType).toBe(null)
  })

  test('Returns null if server version last 16 bits are not 0', () => {
    const incorrectVersionLast16B = decodeServerVersion('1745990418748670208')
    expect(incorrectVersionLast16B).toBe(null)
  })
})
