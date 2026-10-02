import logger from './logger'

const log = logger({ name: 'keep-alive' })

/**
 * Logs unhandled promise rejections instead of letting them exit the process.
 *
 * These are long-lived ingest services. Much of the work is dispatched
 * fire-and-forget (`void handleValidation(...)`, async `setInterval` callbacks),
 * so a rejection anywhere in those paths has nowhere to go. Since Node 15 the
 * default for an unhandled rejection is to throw, which exits the process - a
 * single transient `KnexTimeoutError` from a saturated connection pool was
 * enough to crash-loop vhs-connections.
 *
 * A failed database call must never take the service down: the next validation,
 * crawl or job run should simply try again. Rejections are logged at error level
 * so they stay visible rather than silently swallowed.
 *
 * Note this deliberately does NOT trap `uncaughtException`. A synchronous throw
 * can leave the process in an indeterminate state, where continuing is worse
 * than restarting.
 *
 * @param service - Name of the service, included in the log line.
 */
export default function keepAliveOnUnhandledRejection(service: string): void {
  process.on('unhandledRejection', (reason: unknown) => {
    log.error(`Unhandled promise rejection in ${service}; continuing`, reason)
  })
}
