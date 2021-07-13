import bunyan from 'bunyan'

export default function logger(options:{name:string}) {
  const logger = bunyan.createLogger(options);

  return {
    info: (arg:string) => {
      logger.info(arg);
    },
    warn: (arg:string) => {
      logger.warn(arg);
    },
    error: (arg:string) => {
      logger.error(arg);
    },
    debug: (arg:string) => {
      logger.debug(arg);
    }
  };
};
