/* eslint-disable import/no-unused-modules -- Disable for index file. */
import 'dotenv/config'
import moment from 'moment'

import { setupTables, getNetworks } from '../shared/database'
import keepAliveOnUnhandledRejection from '../shared/utils/keep-alive'
import logger from '../shared/utils/logger'

import Crawler from './crawl'
import locate from './locate'

keepAliveOnUnhandledRejection('crawler')

const log = logger({ name: 'crawler-start' })
const LOCATE_INTERVAL = 24 * 60 * 60 * 1000
const CRAWL_INTERVAL = 2 * 60 * 1000

async function crawl(): Promise<void> {
  const crawlers: Crawler[] = []
  const startCrawl = moment.utc()
  try {
    const networks = await getNetworks()
    const promises = []
    for (const entry of networks) {
      const crawler = new Crawler()
      crawlers.push(crawler)
      promises.push(crawler.crawl(entry))
    }
    // allSettled, not all: a single network's crawl rejecting must not abort
    // the cycle, so the summary line below always logs. That line is what the
    // "no crawl activity" alert watches; losing it reads as a dead crawler
    // even while other networks crawled fine.
    const results = await Promise.allSettled(promises)
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    )
    for (const result of rejected) {
      log.error(`Error crawling network`, result.reason)
    }
  } catch (err) {
    log.error(`Error during crawl cycle`, err)
  } finally {
    const duration = moment.utc().diff(startCrawl) / 1000
    const peers = crawlers.reduce(
      (size, crawler) => crawler.publicKeysSeen.size + size,
      0,
    )
    log.info(`Crawl took ${duration} seconds, ${peers} peers discovered`)
  }
}

async function start(): Promise<void> {
  await setupTables()
  await crawl()
  void locate()
}

async function main(): Promise<void> {
  try {
    await start()
  } catch (err) {
    // Don't let a failed first crawl stop the periodic crawls from being
    // scheduled - the service should keep retrying, not go dark.
    log.error(`Error during crawler startup`, err)
  }

  setInterval(() => {
    void crawl()
  }, CRAWL_INTERVAL)

  setInterval(() => {
    void locate()
  }, LOCATE_INTERVAL)
}

main().catch((err: Error) => log.error(`${err.message}`))
