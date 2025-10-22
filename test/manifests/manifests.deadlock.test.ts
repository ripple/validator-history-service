import { DatabaseManifest } from '../../src/shared/types'

jest.mock('../../src/shared/database/utils', () => {
  const actual = jest.requireActual('../../src/shared/database/utils')
  return {
    ...actual,
    query: jest.fn(),
  }
})

import { handleRevocations } from '../../src/shared/database'
import { query } from '../../src/shared/database/utils'

jest.spyOn(global, 'setTimeout');

describe('handleRevocations - deadlock retry', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  afterEach(() => {
  })

  test('retries on deadlock (code 40P01) with exponential backoff and then succeeds', async () => {
    jest.setTimeout(10000)
    const deadlockErr = Object.assign(new Error('deadlock detected'), { code: '40P01' })
    const updateMock = jest
      .fn()
      .mockRejectedValueOnce(deadlockErr) // attempt 1 -> deadlock
      .mockRejectedValueOnce(deadlockErr) // attempt 2 -> deadlock
      .mockResolvedValue([{ signing_key: 'nSIGNING1' }]) // attempt 3 -> success

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
      domain: null as any,
      domain_verified: false,
    }

    // advance through the two backoff waits: 1s then 2s; wait for the completion of Exponential Backoff retries to resolve the DB deadlock
    // TODO: After upgrading to Jest 29, make use of jest fakeTimers

    const updated = await handleRevocations(manifest)
    await new Promise(resolve => setTimeout(resolve, 3000));
    expect(setTimeout).toHaveBeenCalledTimes(2 + 1); // 2 retries + 1 invocation in this test
    expect(updateMock).toHaveBeenCalledTimes(3)

    // returns the original manifest with possibly-updated revoked flag
    expect(updated.master_key).toBe('nMASTER1')
    expect(updated.seq).toBe(5)
  })
})
