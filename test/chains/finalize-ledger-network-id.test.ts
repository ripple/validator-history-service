import chains from '../../src/connection-manager/chains'
import { destroy, query, setupTables } from '../../src/shared/database'
import type { LedgerHashIndex, ValidationRaw } from '../../src/shared/types'

jest.useFakeTimers()

const SIGNATURE =
  '30440220342DFBFBA1ACF758805A1CD5FF0C4E39F0A2800D0400F430A22BEBDB2B9E327A02204776C0E90942FB9CACDB763535AFAADBA1506E94CD92A605296153D8362D01E3'

function makeValidation(
  overrides: Partial<ValidationRaw> & {
    ledger_hash: string
    ledger_index: string
    validation_public_key: string
    network_id: number
  },
): ValidationRaw {
  return {
    flags: 2147483649,
    full: true,
    master_key: `${overrides.validation_public_key}_MASTER`,
    signature: SIGNATURE,
    signing_time: 669928656,
    type: 'validationReceived',
    ...overrides,
  } as ValidationRaw
}

describe('finalizeLedgerNetworkID', () => {
  beforeAll(async () => {
    await setupTables()
  })

  afterAll(async () => {
    await destroy()
  })

  beforeEach(async () => {
    await query('connection_health').delete('*')
    await query('crawls').delete('*')
    chains.setChains([])
  })

  test('unanimous network_id: all validators agree', async () => {
    const validations = [
      makeValidation({
        ledger_hash: 'HASH_A',
        ledger_index: '1',
        validation_public_key: 'VAL1',
        network_id: 0,
      }),
      makeValidation({
        ledger_hash: 'HASH_A',
        ledger_index: '1',
        validation_public_key: 'VAL2',
        network_id: 0,
      }),
      makeValidation({
        ledger_hash: 'HASH_A',
        ledger_index: '1',
        validation_public_key: 'VAL3',
        network_id: 0,
      }),
    ]

    for (const v of validations) {
      await chains.updateLedgers(v)
    }

    const time = Date.now() + 11000
    Date.now = (): number => time

    const constructed = chains.calculateChainsFromLedgers()
    expect(constructed).toHaveLength(1)
    expect(constructed[0].network_id).toBe(0)
    expect(constructed[0].validators).toEqual(new Set(['VAL1', 'VAL2', 'VAL3']))
    expect(constructed[0].ledgers).toEqual(
      new Set([{ ledger_hash: 'HASH_A', ledger_index: 1 } as LedgerHashIndex]),
    )
    expect(constructed[0].current).toBe(1)
    expect(constructed[0].first).toBe(1)
    expect(constructed[0].incomplete).toBe(true)
  })

  test('majority wins: misconfigured minority does not corrupt network_id', async () => {
    const validations = [
      makeValidation({
        ledger_hash: 'HASH_B',
        ledger_index: '10',
        validation_public_key: 'VAL1',
        network_id: 0,
      }),
      makeValidation({
        ledger_hash: 'HASH_B',
        ledger_index: '10',
        validation_public_key: 'VAL2',
        network_id: 0,
      }),
      makeValidation({
        ledger_hash: 'HASH_B',
        ledger_index: '10',
        validation_public_key: 'VAL3',
        network_id: 0,
      }),
      // misconfigured validator reports testnet
      makeValidation({
        ledger_hash: 'HASH_B',
        ledger_index: '10',
        validation_public_key: 'VAL_BAD',
        network_id: 1,
      }),
    ]

    for (const v of validations) {
      await chains.updateLedgers(v)
    }

    const time = Date.now() + 11000
    Date.now = (): number => time

    const constructed = chains.calculateChainsFromLedgers()
    expect(constructed).toHaveLength(1)
    expect(constructed[0].network_id).toBe(0)
    expect(constructed[0].validators).toEqual(
      new Set(['VAL1', 'VAL2', 'VAL3']),
    )
    expect(constructed[0].validators).not.toContain('VAL_BAD')
    expect(constructed[0].ledgers).toEqual(
      new Set([{ ledger_hash: 'HASH_B', ledger_index: 10 } as LedgerHashIndex]),
    )
    expect(constructed[0].current).toBe(10)
    expect(constructed[0].first).toBe(10)
    expect(constructed[0].incomplete).toBe(true)
  })

  test('multiple ledgers finalized independently', async () => {
    const validations = [
      // Ledger on mainnet
      makeValidation({
        ledger_hash: 'HASH_MAIN',
        ledger_index: '100',
        validation_public_key: 'MVAL1',
        network_id: 0,
      }),
      makeValidation({
        ledger_hash: 'HASH_MAIN',
        ledger_index: '100',
        validation_public_key: 'MVAL2',
        network_id: 0,
      }),
      // Ledger on testnet
      makeValidation({
        ledger_hash: 'HASH_TEST',
        ledger_index: '200',
        validation_public_key: 'TVAL1',
        network_id: 1,
      }),
      makeValidation({
        ledger_hash: 'HASH_TEST',
        ledger_index: '200',
        validation_public_key: 'TVAL2',
        network_id: 1,
      }),
    ]

    for (const v of validations) {
      await chains.updateLedgers(v)
    }

    const time = Date.now() + 11000
    Date.now = (): number => time

    const constructed = chains.calculateChainsFromLedgers()
    expect(constructed).toHaveLength(2)

    const mainnetChain = constructed.find((c) => c.network_id === 0)
    const testnetChain = constructed.find((c) => c.network_id === 1)

    expect(mainnetChain).toBeDefined()
    expect(mainnetChain!.validators).toEqual(new Set(['MVAL1', 'MVAL2']))
    expect(mainnetChain!.ledgers).toEqual(
      new Set([
        { ledger_hash: 'HASH_MAIN', ledger_index: 100 } as LedgerHashIndex,
      ]),
    )
    expect(mainnetChain!.current).toBe(100)
    expect(mainnetChain!.first).toBe(100)
    expect(mainnetChain!.incomplete).toBe(true)

    expect(testnetChain).toBeDefined()
    expect(testnetChain!.validators).toEqual(new Set(['TVAL1', 'TVAL2']))
    expect(testnetChain!.ledgers).toEqual(
      new Set([
        { ledger_hash: 'HASH_TEST', ledger_index: 200 } as LedgerHashIndex,
      ]),
    )
    expect(testnetChain!.current).toBe(200)
    expect(testnetChain!.first).toBe(200)
    expect(testnetChain!.incomplete).toBe(true)
  })

  test('tie-breaking: first network_id with highest count wins', async () => {
    const validations = [
      makeValidation({
        ledger_hash: 'HASH_TIE',
        ledger_index: '50',
        validation_public_key: 'VAL1',
        network_id: 0,
      }),
      makeValidation({
        ledger_hash: 'HASH_TIE',
        ledger_index: '50',
        validation_public_key: 'VAL2',
        network_id: 0,
      }),
      makeValidation({
        ledger_hash: 'HASH_TIE',
        ledger_index: '50',
        validation_public_key: 'VAL1_BAD',
        network_id: 1,
      }),
      makeValidation({
        ledger_hash: 'HASH_TIE',
        ledger_index: '50',
        validation_public_key: 'VAL2_BAD',
        network_id: 1,
      }),
    ]

    for (const v of validations) {
      await chains.updateLedgers(v)
    }

    const time = Date.now() + 11000
    Date.now = (): number => time

    const constructed = chains.calculateChainsFromLedgers()
    expect(constructed).toHaveLength(1)
    // With equal votes, the first network_id inserted into the Map wins
    expect(constructed[0].network_id).toBe(0)
    expect(constructed[0].validators).toEqual(new Set(['VAL1', 'VAL2']))
    expect(constructed[0].validators).not.toContain('VAL1_BAD')
    expect(constructed[0].validators).not.toContain('VAL2_BAD')
    expect(constructed[0].ledgers).toEqual(
      new Set([
        { ledger_hash: 'HASH_TIE', ledger_index: 50 } as LedgerHashIndex,
      ]),
    )
    expect(constructed[0].current).toBe(50)
    expect(constructed[0].first).toBe(50)
    expect(constructed[0].incomplete).toBe(true)
  })
})
