import { setupValidatedLedgersTable } from '../../../src/shared/database/setup'
import { db } from '../../../src/shared/database/utils'

jest.mock('../../../src/shared/database/utils')

describe('setupValidatedLedgersTable', () => {
  it('creates table if not exists with all columns', async () => {
    ;(db as jest.Mock).mockReturnValue({
      schema: {
        hasTable: jest.fn().mockResolvedValue(false),
        createTable: jest.fn(),
      },
    })
    await setupValidatedLedgersTable()

    // eslint-disable-next-line @typescript-eslint/unbound-method -- db() method is required for testing purposes.
    expect(db().schema.hasTable).toHaveBeenCalledWith('validated_ledgers')
    // eslint-disable-next-line @typescript-eslint/unbound-method -- db() method is required for testing purposes.
    expect(db().schema.createTable).toHaveBeenCalledWith(
      'validated_ledgers',
      expect.any(Function),
    )
  })

  it('skips if table exists', async () => {
    ;(db as jest.Mock).mockReturnValue({
      schema: {
        hasTable: jest.fn().mockResolvedValue(true),
        createTable: jest.fn(),
      },
    })

    await setupValidatedLedgersTable()
    // eslint-disable-next-line @typescript-eslint/unbound-method -- db() method is required for testing purposes.
    expect(db().schema.hasTable).toHaveBeenCalledWith('validated_ledgers')
    // eslint-disable-next-line @typescript-eslint/unbound-method -- db() method is required for testing purposes.
    expect(db().schema.createTable).not.toHaveBeenCalled()
  })
})
