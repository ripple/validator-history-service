// import chains from '../../src/connection-manager/chains'
import type { ValidationRaw } from '../../src/shared/types'

interface MockLogger {
  trace: jest.Mock
  info: jest.Mock
  warn: jest.Mock
  error: jest.Mock
  debug: jest.Mock
}

describe('XRPL Mainnet continuity check - missing ledgers', () => {
  let errorMock: jest.Mock

  beforeEach(() => {
    jest.resetModules()
    errorMock = jest.fn()
  })

  test('missing ledgers must trigger error log statements', async () => {
    jest.isolateModules(async () => {
      jest.doMock('../../src/shared/utils/logger', () => ({
        __esModule: true,
        default: (): MockLogger => ({
          trace: jest.fn(),
          info: jest.fn(),
          warn: jest.fn(),
          // capture chains.ts log.error
          error: errorMock,
          debug: jest.fn(),
        }),
      }))

      // eslint-disable-next-line max-len -- comment is required to explain the mock behavior
      /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires, n/global-require -- import AFTER mocking so chains grabs the mocked logger */
      const chains = (
        require('../../src/connection-manager/chains') as {
          default: typeof import('../../src/connection-manager/chains').default
        }
      ).default
      /* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires, n/global-require */

      const originalNow = Date.now
      const base = originalNow()

      // Feed validations out of order; indices are large to avoid the "really old mainnet" filter
      const makeValidationMessage = (
        hash: string,
        index: number,
        signer: string,
      ): ValidationRaw => ({
        flags: 0,
        full: true,
        ledger_hash: hash,
        ledger_index: String(index),
        master_key: `${signer}_MASTER`,
        signature: 'sig',
        signing_time: base,
        type: 'validationReceived',
        validation_public_key: signer,
        network_id: 0,
      })

      // First-seen timestamps
      Date.now = (): number => base

      // Two distinct validations per ledger (required by calculateChainsFromLedgers).
      // Intentionally skip the ledger in the middle.
      const L1 = 100000001
      const L3 = 100000003

      // clear the previous state of the chains module
      await chains.purgeChains()
      // out-of-order ledgers will be sorted by ledger_index
      await chains.updateLedgers(makeValidationMessage('H3', L3, 'VAL_A'))
      await chains.updateLedgers(makeValidationMessage('H3', L3, 'VAL_B'))

      await chains.updateLedgers(makeValidationMessage('H1', L1, 'VAL_A'))
      await chains.updateLedgers(makeValidationMessage('H1', L1, 'VAL_B'))

      // Age entries past 10s threshold so they are processed
      Date.now = (): number => base + 11_000

      // Triggers the sort-and-continuity check; should NOT log errors
      chains.calculateChainsFromLedgers()

      // No error logs expected after sorting by ledger_index
      expect(errorMock).toHaveBeenCalledTimes(1)
      expect(errorMock).toHaveBeenCalledWith(
        'Ledgers are not consecutive on XRPL Mainnet. Void between indices: 100000001 and 100000003',
      )

      // restore clock
      // eslint-disable-next-line require-atomic-updates -- even if a race condition exists, it is not a problem here
      Date.now = originalNow
    })
  })
})
