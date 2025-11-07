import chains from '../../src/connection-manager/chains'
import { destroy, query, setupTables } from '../../src/shared/database'
import type { Chain } from '../../src/shared/types'

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

  test('test the assignment of ledger into an existing chain', async () => {
    // At this point, there are three candidate-chains for the assignment of a ledger
    chains.setChains([{
      network_id: 1025,
      current: 1,
      first: 1,
      validators: new Set(['VALIDATOR1', 'VALIDATOR2', 'VALIDATOR3']),
      updated: Date.now(),
      ledgers: new Set(['LEDGER1']),
      incomplete: true,
    } as Chain,
    {
      network_id: 1026,
      current: 1,
      first: 1,
      validators: new Set(['VALIDATOR11', 'VALIDATOR12', 'VALIDATOR13']),
      updated: Date.now(),
      ledgers: new Set(['LEDGER11']),
      incomplete: true,
    } as Chain,
    {
      network_id: 1027,
      current: 1,
      first: 1,
      validators: new Set(['VALIDATOR21', 'VALIDATOR22', 'VALIDATOR23']),
      updated: Date.now(),
      ledgers: new Set(['LEDGER21']),
      incomplete: true,
    } as Chain])

    // system under test: updateChains
    chains.updateChains({
      ledger_hash: 'LEDGER2',
      ledger_index: 2,
      validations: new Set(['VALIDATOR1', 'VALIDATOR2', 'VALIDATOR3']),
      first_seen: Date.now(),
      network_id: 1025,
    })

    // LEDGER2 must be added to the correct network_id chain
    expect(chains.getChains()).toHaveLength(3)
    expect(chains.getChains()).toContainEqual({
      network_id: 1025,
      current: 2,
      first: 1,
      validators: new Set(['VALIDATOR1', 'VALIDATOR2', 'VALIDATOR3']),
      updated: Date.now(),
      ledgers: new Set(['LEDGER1', 'LEDGER2']),
      incomplete: true,
    } as Chain)

    // a rigorous check to ensure other chains are unchanged
    expect(chains.getChains()).toEqual([{
      network_id: 1025,
      current: 2,
      first: 1,
      validators: new Set(['VALIDATOR1', 'VALIDATOR2', 'VALIDATOR3']),
      updated: Date.now(),
      ledgers: new Set(['LEDGER1', 'LEDGER2']), // Note: This is the only change in the state of the system under test
      incomplete: true,
    } as Chain,
    {
      network_id: 1026,
      current: 1,
      first: 1,
      validators: new Set(['VALIDATOR11', 'VALIDATOR12', 'VALIDATOR13']),
      updated: Date.now(),
      ledgers: new Set(['LEDGER11']),
      incomplete: true,
    } as Chain,
    {
      network_id: 1027,
      current: 1,
      first: 1,
      validators: new Set(['VALIDATOR21', 'VALIDATOR22', 'VALIDATOR23']),
      updated: Date.now(),
      ledgers: new Set(['LEDGER21']),
      incomplete: true,
    } as Chain])
  })

  test('test the assignment of ledger into an hitherto unseen chain', async () => {
    // The chains list does not have any chains with network_id == 1025
    chains.setChains([{
      network_id: 1,
      current: 1,
      first: 1,
      validators: new Set(['VALIDATOR1', 'VALIDATOR2', 'VALIDATOR3']),
      updated: Date.now(),
      ledgers: new Set(['LEDGER1']),
      incomplete: true,
    } as Chain,])

    // system under test: updateChains
    chains.updateChains({
      ledger_hash: 'LEDGER100',
      ledger_index: 1,
      validations: new Set(['VALIDATOR100', 'VALIDATOR200', 'VALIDATOR300']),
      first_seen: Date.now(),
      network_id: 1025,
    })

    expect(chains.getChains()).toHaveLength(2)
    // ensure that the newly inserted ledger is assigned to the correct chain
    expect(chains.getChains()).toContainEqual({
      network_id: 1025,
      current: 1,
      first: 1,
      validators: new Set(['VALIDATOR100', 'VALIDATOR200', 'VALIDATOR300']),
      incomplete: true,
      ledgers: new Set(['LEDGER100']),
      updated: Date.now(),
    } as Chain)
  })

  test('test the assignment of a ledger into an empty chains list', async () => {
    chains.setChains([])

    chains.updateChains({
      ledger_hash: 'LEDGER100',
      ledger_index: 1,
      validations: new Set(['VALIDATOR100', 'VALIDATOR200', 'VALIDATOR300']),
      first_seen: Date.now(),
      network_id: 1025,
    })

    expect(chains.getChains()).toHaveLength(1)
    expect(chains.getChains()).toContainEqual({
      network_id: 1025,
      current: 1,
      first: 1,
      validators: new Set(['VALIDATOR100', 'VALIDATOR200', 'VALIDATOR300']),
      incomplete: true,
      ledgers: new Set(['LEDGER100']),
      updated: Date.now(),
    } as Chain)
  })
})
