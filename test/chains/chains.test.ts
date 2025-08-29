import chains from '../../src/connection-manager/chains'
import { destroy, query, setupTables } from '../../src/shared/database'
import { ValidatedLedger } from '../../src/shared/database/validatedLedgers'

import validations from './fixtures/all-validations.json'

jest.useFakeTimers()

describe('Creates chains', () => {
  beforeAll(async () => {
    await setupTables()
  })

  afterAll(async () => {
    await destroy()
  })

  beforeEach(async () => {
    await query('connection_health').delete('*')
    await query('crawls').delete('*')

    try {
      // seed the validated_ledgers table with 3 entries to mock the incoming LedgerStream
      await query('validated_ledgers').insert({
        ledger_hash: 'LEDGER1',
        ledger_index: 1,
        network: 'chain.0',
        ledger_time: 809801090,
        fee_base: 10,
        reserve_base: 1000000,
        reserve_inc: 200000,
      })
      await query('validated_ledgers').insert({
        ledger_hash: 'LEDGER2',
        ledger_index: 2,
        network: 'chain.0',
        ledger_time: 809801090,
        fee_base: 10,
        reserve_base: 1000000,
        reserve_inc: 200000,
      })
      await query('validated_ledgers').insert({
        ledger_hash: 'LEDGER3',
        ledger_index: 3,
        network: 'chain.0',
        ledger_time: 809801090,
        fee_base: 10,
        reserve_base: 1000000,
        reserve_inc: 200000,
      })
    } catch (error) {
      if (typeof error === 'string') {
        throw new Error(`Unable to insert mocked test data: ${error}`)
      } else if (error instanceof Error) {
        throw new Error(`Unable to insert mocked test data: ${error.message}`)
      } else {
        throw new Error(`Unable to insert mocked test data: ${String(error)}`)
      }
    }
  })

  afterEach(async () => {
    await query('validated_ledgers').delete('*')
  })

  test('Perfect validation scores', async () => {
    for (const validation of validations) {
      chains.updateLedgers(validation)
    }

    const time = Date.now() + 11000

    // Mock date.now
    Date.now = (): number => time
    const constructed: Array<{
      ledgers: Set<string>
      validators: Set<string>
    }> = await chains.calculateChainsFromLedgers()

    expect(constructed[0].ledgers).toContain('LEDGER1')
    expect(constructed[0].ledgers).toContain('LEDGER2')
    expect(constructed[0].ledgers).toContain('LEDGER3')

    expect(constructed[0].validators).toContain('VALIDATOR1')
    expect(constructed[0].validators).toContain('VALIDATOR2')
    expect(constructed[0].validators).toContain('VALIDATOR3')

    // the validated_ledgers table should have 3 entries along with appropriate validation_public_keys
    const validatedLedgers: ValidatedLedger[] = (await query(
      'validated_ledgers',
    ).select('*')) as ValidatedLedger[]
    expect(validatedLedgers.length).toBe(3)
    expect(validatedLedgers[0].validation_public_keys).toEqual([
      'VALIDATOR1',
      'VALIDATOR2',
      'VALIDATOR3',
    ])
    expect(validatedLedgers[1].validation_public_keys).toEqual([
      'VALIDATOR1',
      'VALIDATOR2',
      'VALIDATOR3',
    ])
    expect(validatedLedgers[2].validation_public_keys).toEqual([
      'VALIDATOR1',
      'VALIDATOR2',
      'VALIDATOR3',
    ])
  })

  test('Purge chains removes ledgers', async () => {
    await chains.purgeChains()

    const constructed: Array<{
      ledgers: Set<string>
      validators: Set<string>
    }> = await chains.calculateChainsFromLedgers()

    expect(constructed[0].ledgers).toEqual(new Set())

    expect(constructed[0].validators).toContain('VALIDATOR1')
    expect(constructed[0].validators).toContain('VALIDATOR2')
    expect(constructed[0].validators).toContain('VALIDATOR3')
  })
})
