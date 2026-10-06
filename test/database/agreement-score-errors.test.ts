// getAgreementScores is awaited directly inside calculateAgreement()'s
// per-validator Promise.all, with no catch at any call site. A rejection
// here (e.g. a saturated Knex pool) used to propagate all the way up and
// abort purgeHourlyAgreementScores()/chains.purgeChains()/reported_at for
// every validator in that hour, not just the one that failed. The read
// must swallow its errors, same as every write in this module already does.

const poolTimeout = async (): Promise<never> =>
  Promise.reject(
    new Error(
      'Knex: Timeout acquiring a connection. The pool is probably full.',
    ),
  )

interface FailingBuilder {
  select: () => FailingBuilder
  where: () => FailingBuilder
  then: Promise<never>['then']
}

const failingBuilder = {} as FailingBuilder
Object.assign(failingBuilder, {
  select: (): FailingBuilder => failingBuilder,
  where: (): FailingBuilder => failingBuilder,
  then: async (...args: Parameters<Promise<never>['then']>) =>
    poolTimeout().then(...args),
})

jest.mock('../../src/shared/database/utils', () => ({
  query: (): FailingBuilder => failingBuilder,
  db: (): { raw: () => Promise<never> } => ({ raw: poolTimeout }),
  destroy: async (): Promise<void> => undefined,
  tearDown: async (): Promise<void> => undefined,
}))

// eslint-disable-next-line import/first -- must be imported after the mock above
import { getAgreementScores } from '../../src/shared/database/agreement'

describe('getAgreementScores error containment', () => {
  it('resolves with an empty score instead of rejecting when the pool is saturated', async () => {
    await expect(
      getAgreementScores(
        { signing_key: 'n9SaturatedPool' },
        new Date(0),
        new Date(),
      ),
    ).resolves.toEqual({ validated: 0, missed: 0, incomplete: false })
  })
})
