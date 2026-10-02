import keepAliveOnUnhandledRejection from '../../src/shared/utils/keep-alive'

describe('keepAliveOnUnhandledRejection', () => {
  const existing = process.listeners('unhandledRejection')

  afterEach(() => {
    process.removeAllListeners('unhandledRejection')
    existing.forEach((listener) => {
      process.on('unhandledRejection', listener)
    })
  })

  it('registers a handler so a rejection does not reach the default (exit)', () => {
    process.removeAllListeners('unhandledRejection')
    expect(process.listenerCount('unhandledRejection')).toBe(0)

    keepAliveOnUnhandledRejection('test-service')

    expect(process.listenerCount('unhandledRejection')).toBe(1)
  })

  it('does not trap uncaughtException, where continuing is unsafe', () => {
    const before = process.listenerCount('uncaughtException')

    keepAliveOnUnhandledRejection('test-service')

    expect(process.listenerCount('uncaughtException')).toBe(before)
  })
})
