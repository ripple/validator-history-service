import { rippleTimeToUnixTime } from 'xrpl'

import { query } from '../../../src/shared/database/utils'
import { insertValidatedLedger } from '../../../src/shared/database/validatedLedgers'
import { StreamLedger } from '../../../src/shared/types'

jest.mock('../../../src/shared/database/utils')

describe('insertValidatedLedger', () => {
  const mockLedger: StreamLedger = {
    type: 'ledgerClosed',
    ledger_index: 98313833,
    ledger_hash:
      '34F133C16E49FDB91E3BA6C59CCF9AD7F48BBDEFEB4277FF77C41367AA16FEBE',
    ledger_time: 809104601,
    fee_base: 10,
    reserve_base: 1000000,
    reserve_inc: 200000,
    validated_ledgers: '32570-98313833',
    txn_count: 106,
  }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('inserts a new ledger with correct time conversion', async () => {
    const mockInsert = jest.fn().mockReturnValue({
      onConflict: jest.fn().mockReturnValue({ ignore: jest.fn() }),
    })
    ;(query as jest.Mock).mockReturnValue({ insert: mockInsert })

    await insertValidatedLedger('main', mockLedger)

    expect(query).toHaveBeenCalledWith('validated_ledgers')
    expect(mockInsert).toHaveBeenCalledWith({
      network: 'main',
      ledger_hash:
        '34F133C16E49FDB91E3BA6C59CCF9AD7F48BBDEFEB4277FF77C41367AA16FEBE',
      ledger_index: 98313833,
      ledger_time: new Date(rippleTimeToUnixTime(809104601)),
      fee_base: 10,
      reserve_base: 1000000,
      reserve_inc: 200000,
      txn_count: 106,
    })
  })

  it('ignores on conflict', async () => {
    const mockOnConflict = jest.fn().mockReturnValue({ ignore: jest.fn() })
    const mockInsert = jest.fn().mockReturnValue({ onConflict: mockOnConflict })
    ;(query as jest.Mock).mockReturnValue({ insert: mockInsert })

    await insertValidatedLedger('main', mockLedger)

    expect(mockOnConflict).toHaveBeenCalledWith([
      'ledger_index',
      'network',
      'ledger_hash',
    ])
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- ignore is a mock function
    expect(mockOnConflict().ignore).toHaveBeenCalled()
  })
})
