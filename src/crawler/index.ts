import 'dotenv/config'
import moment from 'moment'

import { setupTable } from '../shared/database'
import config from '../shared/utils/config'
import logger from '../shared/utils/logger'

import Crawler from './crawl'
import locate from './locate'

const log = logger({ name: 'crawler-start' })
const LOCATE_INTERVAL = 24 * 60 * 60 * 1000
const CRAWL_INTERVAL = 2 * 60 * 1000

async function crawl(): Promise<void> {
  const crawler = new Crawler()

  const promises = []
  for (const entry of config.entries) {
    promises.push(crawler.crawl(entry))
  }
  await Promise.all(promises)

  const duration = moment.utc().diff(crawler.start) / 1000
  const peers = crawler.publicKeysSeen.size
  log.info(`Crawl took ${duration} seconds, ${peers} peers discovered`)
}

async function start(): Promise<void> {
  await setupTable()
  await crawl()
  void locate()
}

async function main(): Promise<void> {
  await start()

  setInterval(() => {
    void crawl()
  }, CRAWL_INTERVAL)

  setInterval(() => {
    void locate()
  }, LOCATE_INTERVAL)
}

main().catch((err: Error) => log.error(`${err.message}`))
