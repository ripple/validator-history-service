import { handleRevocations } from '../../src/shared/database'
import { query } from '../../src/shared/database/utils'
import { DatabaseManifest } from '../../src/shared/types'

jest.mock('../../src/shared/database/utils', () => {
  const actual: typeof import('../../src/shared/database/utils') =
    jest.requireActual('../../src/shared/database/utils')
  return {
    ...actual,
    query: jest.fn(),
  }
})

jest.spyOn(global, 'setTimeout')

describe('handleRevocations - deadlock retry', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('retries on deadlock (code 40P01) with exponential backoff and then succeeds', async () => {
    jest.setTimeout(10000)
    const deadlockErr = Object.assign(new Error('deadlock detected'), {
      code: '40P01',
    })
    const updateMock = jest
      .fn()
      // attempt 1 -> deadlock
      .mockRejectedValueOnce(deadlockErr)
      // attempt 2 -> deadlock
      .mockRejectedValueOnce(deadlockErr)
      // attempt 3 -> success
      .mockResolvedValue([{ signing_key: 'nSIGNING1' }])

    const manifestsBuilder = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      update: updateMock,
      // for the later "newer manifests" lookup in handleRevocations
      catch: jest.fn().mockResolvedValue([]),
    }

    const validatorsBuilder = {
      whereIn: jest.fn().mockReturnThis(),
      update: jest.fn().mockResolvedValue(undefined),
    }

    ;(query as jest.Mock).mockImplementation((table: string) => {
      return table === 'manifests' ? manifestsBuilder : validatorsBuilder
    })

    const manifest: DatabaseManifest = {
      master_key: 'nMASTER1',
      signing_key: 'nSIGNING0',
      master_signature: 'abc',
      signature: 'def',
      seq: 5,
      revoked: false,
      domain: undefined,
      domain_verified: false,
    }

    // advance through the two backoff waits: 1s then 2s;
    // wait for the completion of Exponential Backoff retries to resolve the DB deadlock
    // TODO: After upgrading to Jest 29, make use of jest fakeTimers

    const updated = await handleRevocations(manifest)
    // mock has been wired to throw an error twice and then succeed in the third attempt
    // setTimeout is only executed in the case of Deadlock detected error
    expect(setTimeout).toHaveBeenCalledTimes(2)
    expect(updateMock).toHaveBeenCalledTimes(3)

    // returns the original manifest with possibly-updated revoked flag
    expect(updated.master_key).toBe('nMASTER1')
    expect(updated.seq).toBe(5)
    expect(updated.revoked).toBe(false)
  })
})
