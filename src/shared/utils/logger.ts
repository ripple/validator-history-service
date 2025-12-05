import bunyan from 'bunyan'

interface Logger {
  trace: (arg: string) => void
  info: (arg: string) => void
  warn: (arg: string) => void
  error: (arg: string, err?: unknown) => void
  debug: (arg: string) => void
}

interface LoggerOptions {
  // Sets the label for all logs. See bunyan docs for more fields: https://github.com/trentm/node-bunyan#core-fields
  name: string
}

/**
 * Logger function that wraps the bunyan logger.
 *
 * @param options - Object that contains a label for the log e.g. Filename.
 * @returns The logger object.
 */
export default function logger(options: LoggerOptions): Logger {
  const log = bunyan.createLogger({
    ...options,
    serializers: {
      err: bunyan.stdSerializers.err,
    },
  })

  return {
    /**
     * Trace level logs.
     *
     * @param arg - Message.
     */
    trace(arg: string): void {
      log.trace(arg)
    },
    /**
     * Info level logs.
     *
     * @param arg - Message.
     */
    info(arg: string): void {
      log.info(arg)
    },
    /**
     * Warning level logs.
     *
     * @param arg - Message.
     */
    warn(arg: string): void {
      log.warn(arg)
    },
    /**
     * Error level logs.
     *
     * @param arg - Message.
     * @param err - Optional error object from catch block.
     */
    error(arg: string, err?: unknown): void {
      log.error({ err }, arg)
    },
    /**
     * Debug level logs.
     *
     * @param arg - Message.
     */
    debug(arg: string): void {
      log.debug(arg)
    },
  }
}
