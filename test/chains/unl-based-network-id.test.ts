import chains from '../../src/connection-manager/chains'
import { destroy, query, setupTables } from '../../src/shared/database'
import type { ValidationRaw } from '../../src/shared/types'

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

function advanceTimeAndCalculate(): ReturnType<
  typeof chains.calculateChainsFromLedgers
> {
  const time = Date.now() + 11000
  Date.now = (): number => time
  return chains.calculateChainsFromLedgers()
}

describe('UNL-based network_id resolution', () => {
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

  test('UNL validators determine network_id even when non-UNL validators report wrong network_id', async () => {
    chains.setUNLs(
      new Map([
        [0, new Set(['UNL_VAL1', 'UNL_VAL2', 'UNL_VAL3'])],
        [1, new Set(['UNL_TVAL1', 'UNL_TVAL2'])],
      ]),
    )

    const validations = [
      makeValidation({
        ledger_hash: 'HASH_MAIN',
        ledger_index: '100',
        validation_public_key: 'UNL_VAL1',
        network_id: 0,
      }),
      makeValidation({
        ledger_hash: 'HASH_MAIN',
        ledger_index: '100',
        validation_public_key: 'UNL_VAL2',
        network_id: 0,
      }),
      makeValidation({
        ledger_hash: 'HASH_MAIN',
        ledger_index: '100',
        validation_public_key: 'UNL_VAL3',
        network_id: 0,
      }),
      makeValidation({
        ledger_hash: 'HASH_MAIN',
        ledger_index: '100',
        validation_public_key: 'NON_UNL_BAD1',
        network_id: 1,
      }),
      makeValidation({
        ledger_hash: 'HASH_MAIN',
        ledger_index: '100',
        validation_public_key: 'NON_UNL_BAD2',
        network_id: 1,
      }),
    ]

    for (const v of validations) {
      await chains.updateLedgers(v)
    }

    const constructed = advanceTimeAndCalculate()
    expect(constructed).toHaveLength(1)
    expect(constructed[0].network_id).toBe(0)
    expect(constructed[0].validators).toEqual(
      new Set(['UNL_VAL1', 'UNL_VAL2', 'UNL_VAL3']),
    )
    expect(constructed[0].validators).not.toContain('NON_UNL_BAD1')
    expect(constructed[0].validators).not.toContain('NON_UNL_BAD2')
  })

  test('non-UNL majority cannot override UNL-based classification', async () => {
    chains.setUNLs(
      new Map([
        [0, new Set(['UNL_VAL1', 'UNL_VAL2'])],
        [1, new Set(['UNL_TVAL1'])],
      ]),
    )

    // 2 UNL mainnet validators + 5 non-UNL validators claiming testnet
    const validations = [
      makeValidation({
        ledger_hash: 'HASH_CONTESTED',
        ledger_index: '200',
        validation_public_key: 'UNL_VAL1',
        network_id: 0,
      }),
      makeValidation({
        ledger_hash: 'HASH_CONTESTED',
        ledger_index: '200',
        validation_public_key: 'UNL_VAL2',
        network_id: 0,
      }),
      makeValidation({
        ledger_hash: 'HASH_CONTESTED',
        ledger_index: '200',
        validation_public_key: 'NON_UNL_1',
        network_id: 1,
      }),
      makeValidation({
        ledger_hash: 'HASH_CONTESTED',
        ledger_index: '200',
        validation_public_key: 'NON_UNL_2',
        network_id: 1,
      }),
      makeValidation({
        ledger_hash: 'HASH_CONTESTED',
        ledger_index: '200',
        validation_public_key: 'NON_UNL_3',
        network_id: 1,
      }),
      makeValidation({
        ledger_hash: 'HASH_CONTESTED',
        ledger_index: '200',
        validation_public_key: 'NON_UNL_4',
        network_id: 1,
      }),
      makeValidation({
        ledger_hash: 'HASH_CONTESTED',
        ledger_index: '200',
        validation_public_key: 'NON_UNL_5',
        network_id: 1,
      }),
    ]

    for (const v of validations) {
      await chains.updateLedgers(v)
    }

    const constructed = advanceTimeAndCalculate()
    expect(constructed).toHaveLength(1)
    expect(constructed[0].network_id).toBe(0)
    expect(constructed[0].validators).toContain('UNL_VAL1')
    // Despite being a UNL validator, the UNL_VAL2 did not send the correct validation
    expect(constructed[0].validators).not.toContain('UNL_VAL2')
    expect(constructed[0].validators).not.toContain('NON_UNL_1')
    expect(constructed[0].validators).not.toContain('NON_UNL_2')
    expect(constructed[0].validators).not.toContain('NON_UNL_3')
    expect(constructed[0].validators).not.toContain('NON_UNL_4')
    expect(constructed[0].validators).not.toContain('NON_UNL_5')
  })

  test('all UNL and non-UNL validators unanimously agree on network_id', async () => {
    chains.setUNLs(
      new Map([
        [0, new Set(['UNL_VAL1', 'UNL_VAL2'])],
        [1, new Set(['UNL_TVAL1'])],
      ]),
    )

    const validations = [
      makeValidation({
        ledger_hash: 'HASH_UNANIMOUS',
        ledger_index: '300',
        validation_public_key: 'UNL_VAL1',
        network_id: 0,
      }),
      makeValidation({
        ledger_hash: 'HASH_UNANIMOUS',
        ledger_index: '300',
        validation_public_key: 'UNL_VAL2',
        network_id: 0,
      }),
      makeValidation({
        ledger_hash: 'HASH_UNANIMOUS',
        ledger_index: '300',
        validation_public_key: 'NON_UNL_1',
        network_id: 0,
      }),
      makeValidation({
        ledger_hash: 'HASH_UNANIMOUS',
        ledger_index: '300',
        validation_public_key: 'NON_UNL_2',
        network_id: 0,
      }),
    ]

    for (const v of validations) {
      await chains.updateLedgers(v)
    }

    const constructed = advanceTimeAndCalculate()
    expect(constructed).toHaveLength(1)
    expect(constructed[0].network_id).toBe(0)
    expect(constructed[0].validators).toEqual(
      new Set(['UNL_VAL1', 'UNL_VAL2', 'NON_UNL_1', 'NON_UNL_2']),
    )
  })

  test('no UNL data available: ledger is discarded', async () => {
    chains.setUNLs(new Map())

    const validations = [
      makeValidation({
        ledger_hash: 'HASH_NO_UNL',
        ledger_index: '400',
        validation_public_key: 'VAL1',
        network_id: 0,
      }),
      makeValidation({
        ledger_hash: 'HASH_NO_UNL',
        ledger_index: '400',
        validation_public_key: 'VAL2',
        network_id: 0,
      }),
      makeValidation({
        ledger_hash: 'HASH_NO_UNL',
        ledger_index: '400',
        validation_public_key: 'VAL3',
        network_id: 0,
      }),
    ]

    for (const v of validations) {
      await chains.updateLedgers(v)
    }

    const constructed = advanceTimeAndCalculate()
    expect(constructed).toHaveLength(0)
  })

  test('ledger with only non-UNL validators is discarded', async () => {
    chains.setUNLs(
      new Map([
        [0, new Set(['UNL_VAL_NOT_ON_THIS_LEDGER'])],
      ]),
    )

    const validations = [
      makeValidation({
        ledger_hash: 'HASH_NON_UNL_ONLY',
        ledger_index: '500',
        validation_public_key: 'ROGUE1',
        network_id: 0,
      }),
      makeValidation({
        ledger_hash: 'HASH_NON_UNL_ONLY',
        ledger_index: '500',
        validation_public_key: 'ROGUE2',
        network_id: 0,
      }),
      makeValidation({
        ledger_hash: 'HASH_NON_UNL_ONLY',
        ledger_index: '500',
        validation_public_key: 'ROGUE3',
        network_id: 1,
      }),
    ]

    for (const v of validations) {
      await chains.updateLedgers(v)
    }

    const constructed = advanceTimeAndCalculate()
    expect(constructed).toHaveLength(0)
  })

  test('multiple ledgers from different networks with cross-contaminated non-UNL validators', async () => {
    chains.setUNLs(
      new Map([
        [0, new Set(['UNL_M1', 'UNL_M2', 'UNL_M3'])],
        [1, new Set(['UNL_T1', 'UNL_T2', 'UNL_T3'])],
      ]),
    )

    const validations = [
      // Mainnet ledger
      makeValidation({
        ledger_hash: 'HASH_MAINNET',
        ledger_index: '600',
        validation_public_key: 'UNL_M1',
        network_id: 0,
      }),
      makeValidation({
        ledger_hash: 'HASH_MAINNET',
        ledger_index: '600',
        validation_public_key: 'UNL_M2',
        network_id: 0,
      }),
      makeValidation({
        ledger_hash: 'HASH_MAINNET',
        ledger_index: '600',
        validation_public_key: 'FLIP_FLOP',
        network_id: 1,
      }),

      // Testnet ledger
      makeValidation({
        ledger_hash: 'HASH_TESTNET',
        ledger_index: '700',
        validation_public_key: 'UNL_T1',
        network_id: 1,
      }),
      makeValidation({
        ledger_hash: 'HASH_TESTNET',
        ledger_index: '700',
        validation_public_key: 'UNL_T2',
        network_id: 1,
      }),
      makeValidation({
        ledger_hash: 'HASH_TESTNET',
        ledger_index: '700',
        validation_public_key: 'FLIP_FLOP',
        network_id: 0,
      }),
    ]

    for (const v of validations) {
      await chains.updateLedgers(v)
    }

    const constructed = advanceTimeAndCalculate()
    expect(constructed).toHaveLength(2)

    const mainnetChain = constructed.find((c) => c.network_id === 0)
    const testnetChain = constructed.find((c) => c.network_id === 1)

    expect(mainnetChain).toBeDefined()
    expect(mainnetChain!.validators).toEqual(new Set(['UNL_M1', 'UNL_M2']))
    expect(mainnetChain!.validators).not.toContain('FLIP_FLOP')

    expect(testnetChain).toBeDefined()
    expect(testnetChain!.validators).toEqual(new Set(['UNL_T1', 'UNL_T2']))
    expect(testnetChain!.validators).not.toContain('FLIP_FLOP')
  })

  test('UNL validators from conflicting networks on the same ledger: ledger is discarded', async () => {
    chains.setUNLs(
      new Map([
        [0, new Set(['UNL_M1', 'UNL_M2', 'UNL_M3'])],
        [1, new Set(['UNL_T1'])],
      ]),
    )

    const validations = [
      makeValidation({
        ledger_hash: 'HASH_CONFLICT',
        ledger_index: '800',
        validation_public_key: 'UNL_M1',
        network_id: 0,
      }),
      makeValidation({
        ledger_hash: 'HASH_CONFLICT',
        ledger_index: '800',
        validation_public_key: 'UNL_M2',
        network_id: 0,
      }),
      makeValidation({
        ledger_hash: 'HASH_CONFLICT',
        ledger_index: '800',
        validation_public_key: 'UNL_M3',
        network_id: 0,
      }),
      makeValidation({
        ledger_hash: 'HASH_CONFLICT',
        ledger_index: '800',
        validation_public_key: 'UNL_T1',
        network_id: 1,
      }),
    ]

    for (const v of validations) {
      await chains.updateLedgers(v)
    }

    const constructed = advanceTimeAndCalculate()
    expect(constructed).toHaveLength(0)
  })
})
