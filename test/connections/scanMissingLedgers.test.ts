import checkForMissingLedgers from '../../src/connection-manager/scanMissingLedgers'
import { db, query } from '../../src/shared/database'
import { insertMissingLedger } from '../../src/shared/database/validatedLedgers'

import twoMissingLedgers from './fixtures/two-missing-ledgers.json'
import missingLedgerExample from './fixtures/validated-ledgers-missing-98341289.json'
import validatedLedgers from './fixtures/validated-ledgers.json'

jest.mock('../../src/shared/database/validatedLedgers')
jest.mock('../../src/shared/database', async () => {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- tedious to strongly type the contents of a module
  const originalModule = jest.requireActual('../../src/shared/database')

  // eslint-disable-next-line @typescript-eslint/no-unsafe-return -- tedious to strongly type the contents of a module
  return {
    __esModule: true,
    ...originalModule,
    db: jest.fn(),
    query: jest.fn((_tableName: string) => {
      return {
        orderBy: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        select: jest
          .fn()
          .mockReturnThis()
          .mockResolvedValueOnce(validatedLedgers)
          .mockResolvedValueOnce(missingLedgerExample),
      }
    }),
  }
})

describe('scanMissingLedgers', () => {
  afterEach(() => {
    jest.clearAllMocks()
  })

  it('no ledgers are missing', async () => {
    ;(db as jest.Mock).mockReturnValue({
      schema: {
        hasTable: jest.fn().mockResolvedValue(true),
        createTable: jest.fn(),
      },
    })
    ;(insertMissingLedger as jest.Mock).mockResolvedValue(undefined)

    await checkForMissingLedgers()
    // eslint-disable-next-line @typescript-eslint/unbound-method -- db() method is required for testing purposes.
    expect(db().schema.hasTable).toHaveBeenCalledWith('validated_ledgers')
    // eslint-disable-next-line @typescript-eslint/unbound-method -- db() method is required for testing purposes.
    expect(db().schema.hasTable).toHaveBeenCalledWith('missing_ledgers')

    expect(insertMissingLedger).not.toHaveBeenCalled()
  })

  it('ledger_index 98341289 is missing', async () => {
    ;(db as jest.Mock).mockReturnValue({
      schema: {
        hasTable: jest.fn().mockResolvedValue(true),
        createTable: jest.fn(),
      },
    })
    ;(query as jest.Mock).mockReturnValue({
      orderBy: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      select: jest
        .fn()
        .mockReturnThis()
        .mockResolvedValue(missingLedgerExample),
    })

    await checkForMissingLedgers()
    // eslint-disable-next-line @typescript-eslint/unbound-method -- db() method is required for testing purposes.
    expect(db().schema.hasTable).toHaveBeenCalledWith('validated_ledgers')
    // eslint-disable-next-line @typescript-eslint/unbound-method -- db() method is required for testing purposes.
    expect(db().schema.hasTable).toHaveBeenCalledWith('missing_ledgers')

    expect(query).toHaveBeenCalled()

    expect(insertMissingLedger).toHaveBeenCalledWith({
      network: 'main',
      ledger_index: 98341289,
      previous_ledger_index: 98341288,
      previous_ledger_received_at: '2025-08-22T12:00:01.000Z',
    })
  })

  it('two ledgers are missing', async () => {
    ;(db as jest.Mock).mockReturnValue({
      schema: {
        hasTable: jest.fn().mockResolvedValue(true),
        createTable: jest.fn(),
      },
    })
    ;(query as jest.Mock).mockReturnValue({
      orderBy: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis().mockResolvedValue(twoMissingLedgers),
    })

    await checkForMissingLedgers()
    // eslint-disable-next-line @typescript-eslint/unbound-method -- db() method is required for testing purposes.
    expect(db().schema.hasTable).toHaveBeenCalledWith('validated_ledgers')
    // eslint-disable-next-line @typescript-eslint/unbound-method -- db() method is required for testing purposes.
    expect(db().schema.hasTable).toHaveBeenCalledWith('missing_ledgers')

    expect(query).toHaveBeenCalled()

    expect(insertMissingLedger).toHaveBeenCalledTimes(2)
  })
})
