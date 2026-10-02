// saveValidator is reached from `handleValidation`, which the websocket layer
// invokes without awaiting. A rejection that escapes it therefore becomes an
// unhandled rejection and exits the process, which is what crash-looped
// vhs-connections when the Knex pool saturated. Both of its statements must
// swallow their errors.

const poolTimeout = async (): Promise<never> =>
  Promise.reject(
    new Error(
      'Knex: Timeout acquiring a connection. The pool is probably full.',
    ),
  )

interface FailingBuilder {
  insert: () => FailingBuilder
  onConflict: () => FailingBuilder
  merge: () => Promise<never>
  where: () => FailingBuilder
  update: () => Promise<never>
}

const failingBuilder = {} as FailingBuilder
Object.assign(failingBuilder, {
  insert: (): FailingBuilder => failingBuilder,
  onConflict: (): FailingBuilder => failingBuilder,
  merge: poolTimeout,
  where: (): FailingBuilder => failingBuilder,
  update: poolTimeout,
})

jest.mock('../../src/shared/database/utils', () => ({
  query: (): FailingBuilder => failingBuilder,
  db: (): { raw: () => Promise<never> } => ({ raw: poolTimeout }),
  destroy: async (): Promise<void> => undefined,
  tearDown: async (): Promise<void> => undefined,
}))

// eslint-disable-next-line import/first -- must be imported after the mock above
import { saveValidator } from '../../src/shared/database'

describe('saveValidator error containment', () => {
  it('resolves instead of rejecting when the pool is saturated', async () => {
    await expect(
      saveValidator({
        signing_key: 'n9SaturatedPool',
        ledger_hash: 'HASH',
        current_index: 1,
        partial: false,
        last_ledger_time: new Date(),
      }),
    ).resolves.toBeUndefined()
  })
})
