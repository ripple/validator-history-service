import agreement from '../../src/connection-manager/agreement'
import {
  decodeServerVersion,
  destroy,
  query,
  setupTables,
} from '../../src/shared/database'
import {
  DailyAgreement,
  HourlyAgreement,
  ValidationRaw,
} from '../../src/shared/types'

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
    await query('validators').delete('*')
  })

  afterEach(async () => {
    await query('hourly_agreement').delete('*')
    await query('daily_agreement').delete('*')
    await query('manifests').delete('*')
    await query('validators').delete('*')
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

  test('a validation without master_key does not null the stored one', async () => {
    const SIGNING = 'VALIDATOR1'
    const MASTER = 'VALIDATOR1MASTER'
    // As updateValidatorMasterKeys / handleManifest would have left it.
    await query('validators').insert({
      signing_key: SIGNING,
      master_key: MASTER,
      revoked: false,
    })

    // rippled omits master_key when the connected node does not know the
    // validator's manifest. The key must be PRESENT and undefined, not absent:
    // that is what knex turns into SQL DEFAULT (null) via onConflict().merge(),
    // which is the clobber this guards against.
    const withoutMasterKey: ValidationRaw = {
      ...(validations[0] as ValidationRaw),
      master_key: undefined,
      ledger_hash: 'LEDGER_NO_MASTER_KEY',
    }

    await agreement.handleValidation(withoutMasterKey)

    const rows = (await query('validators')
      .select('master_key')
      .where({ signing_key: SIGNING })) as Array<{ master_key: string | null }>

    expect(rows).toHaveLength(1)
    expect(rows[0].master_key).toBe(MASTER)
  })

  test('a validation carrying master_key still sets it', async () => {
    const SIGNING = 'VALIDATOR1'
    const MASTER = 'VALIDATOR1MASTER'
    await query('validators').insert({
      signing_key: SIGNING,
      master_key: null,
      revoked: false,
    })

    await agreement.handleValidation({
      ...(validations[0] as ValidationRaw),
      ledger_hash: 'LEDGER_WITH_MASTER_KEY',
    })

    const rows = (await query('validators')
      .select('master_key')
      .where({ signing_key: SIGNING })) as Array<{ master_key: string | null }>

    expect(rows[0].master_key).toBe(MASTER)
  })
})
