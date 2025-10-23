import chains from '../../src/connection-manager/chains'
import { destroy, query, setupTables } from '../../src/shared/database'
import skippedLedgersValidations from './fixtures/skipped-ledgers-validations.json'
import outOfOrderValidations from './fixtures/out-of-order-validations.json'
import validations from './fixtures/all-validations.json'
import { Chain } from '../../src/shared/types'
import duplicateValidations from './fixtures/duplicate-validations.json'
import newValidatorsVotes from './fixtures/new-validators-votes.json'

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
    chains.__resetChainsSingletonForTests()
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
    }> = chains.calculateChainsFromLedgers()

    expect(constructed[0].ledgers).toContain('LEDGER1')
    expect(constructed[0].ledgers).toContain('LEDGER2')
    expect(constructed[0].ledgers).toContain('LEDGER3')

    expect(constructed[0].validators).toContain('VALIDATOR1')
    expect(constructed[0].validators).toContain('VALIDATOR2')
    expect(constructed[0].validators).toContain('VALIDATOR3')
  })

  test('Purge chains removes ledgers', async () => {
    // This test validates the behavior of purgeChains. As a pre-requisite, assign sample ledgers into appropriate chain-IDs before the purge operation.
    for (const validation of validations) {
      chains.updateLedgers(validation)
    }
    // Mock date.now
    const time = Date.now() + 11000
    Date.now = (): number => time

    // assign ledgers into the appropriate chains
    chains.calculateChainsFromLedgers()

    await chains.purgeChains()

    const constructed: Array<{
      ledgers: Set<string>
      validators: Set<string>
    }> = chains.calculateChainsFromLedgers()

    expect(constructed[0].ledgers).toEqual(new Set())

    expect(constructed[0].validators).toContain('VALIDATOR1')
    expect(constructed[0].validators).toContain('VALIDATOR2')
    expect(constructed[0].validators).toContain('VALIDATOR3')
  })

  test(`Validate the case where VHS misses > 20 ledgers`, async() => {
    for (const validation of skippedLedgersValidations) {
      chains.updateLedgers(validation)
    }

    const time = Date.now() + 11000

    // Mock date.now
    Date.now = (): number => time
    const updatedChains = chains.calculateChainsFromLedgers()
    expect(updatedChains).toHaveLength(1)

    expect(updatedChains[0].id).toBe('chain.0')
    expect(updatedChains[0].current).toBe(38)
    expect(updatedChains[0].first).toBe(1)
    expect(updatedChains[0].validators).toEqual(new Set(['VALIDATOR1', 'VALIDATOR2', 'VALIDATOR3']))
    // Note: It is fragile to test the time when the chain was updated with the latest values.
    expect(updatedChains[0].ledgers).toEqual(new Set(['LEDGER1', 'LEDGER2', 'LEDGER3', 'LEDGER33', 'LEDGER34', 'LEDGER35', 'LEDGER36', 'LEDGER37', 'LEDGER38']))
    expect(updatedChains[0].incomplete).toBe(true)
  })

  test(`Simulate the case where VHS misses <0 ledgers (VHS receives out-of-sync historical ledger)`, async () => {
    for(const validation of outOfOrderValidations) {
      chains.updateLedgers(validation)
    }

    const time = Date.now() + 11000

    // Mock date.now
    Date.now = (): number => time
    const constructed: Array<Chain> = chains.calculateChainsFromLedgers()

    expect(constructed).toHaveLength(1)
    expect(constructed[0].id).toBe('chain.0')
    expect(constructed[0].current).toBe(38)
    expect(constructed[0].first).toBe(1)
    expect(constructed[0].validators).toEqual(new Set(['VALIDATOR1', 'VALIDATOR2', 'VALIDATOR3']))
    expect(constructed[0].ledgers).toEqual(new Set(['LEDGER1', 'LEDGER2', 'LEDGER3', 'LEDGER33', 'LEDGER34', 'LEDGER35', 'LEDGER36', 'LEDGER37', 'LEDGER38', 'LEDGER20', 'LEDGER11']))
    expect(constructed[0].incomplete).toBe(true)
  })

  test(`VHS receives identical copies of the validationReceived message`, async() => {
    for (const validation of duplicateValidations) {
      chains.updateLedgers(validation)
    }

    const time = Date.now() + 11000

    // Mock date.now
    Date.now = (): number => time
    const constructed: Array<Chain> = chains.calculateChainsFromLedgers()

    expect(constructed).toHaveLength(1)
    // Note: duplicate validations are ignored.
    expect(constructed[0].ledgers).toEqual(new Set(['LEDGER1', 'LEDGER2', 'LEDGER3']))
    expect(constructed[0].validators).toEqual(new Set(['VALIDATOR1', 'VALIDATOR2', 'VALIDATOR3']))
    expect(constructed[0].id).toBe('chain.0')
    expect(constructed[0].current).toBe(3)
    expect(constructed[0].first).toBe(1)
    expect(constructed[0].incomplete).toBe(true)
  })

  test(`Simulate the inclusion of two new validators in the validationReceived messages`, async() => {
    for (const validation of newValidatorsVotes) {
      chains.updateLedgers(validation)
    }

    const time = Date.now() + 11000

    // Mock date.now
    Date.now = (): number => time
    const constructed: Array<Chain> = chains.calculateChainsFromLedgers()

    expect(constructed).toHaveLength(1)
    // Note: duplicate validations are ignored.
    expect(constructed[0].ledgers).toEqual(new Set(['LEDGER1', 'LEDGER2', 'LEDGER3', 'LEDGER4']))
    expect(constructed[0].validators).toEqual(new Set(['VALIDATOR1', 'VALIDATOR2', 'VALIDATOR3', 'VALIDATOR4', 'VALIDATOR5']))
    expect(constructed[0].id).toBe('chain.0')
    expect(constructed[0].current).toBe(4)
    expect(constructed[0].first).toBe(1)
    expect(constructed[0].incomplete).toBe(true)
  })
})
