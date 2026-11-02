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
    // the cycle - the other networks should still be crawled and counted.
    const results = await Promise.allSettled(promises)
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    )
    for (const result of rejected) {
      log.error(`Error crawling network`, result.reason)
    }

    const duration = moment.utc().diff(startCrawl) / 1000
    const peers = crawlers.reduce(
      (size, crawler) => crawler.publicKeysSeen.size + size,
      0,
    )

    // The "no crawl activity" alert counts the "...peers discovered" summary
    // line, so only emit it when the cycle actually discovered peers. A cycle
    // that found none - every network rejected, or they resolved but returned
    // nothing - is itself "no crawl activity", so log it as an error WITHOUT
    // the summary phrase rather than a green-looking "0 peers discovered".
    if (peers > 0) {
      log.info(`Crawl took ${duration} seconds, ${peers} peers discovered`)
    } else {
      log.error(
        `Crawl cycle discovered 0 peers after ${duration}s (${rejected.length}/${results.length} networks errored)`,
      )
    }
  } catch (err) {
    // getNetworks() or another cycle-level step failed: nothing was crawled.
    // Deliberately no "peers discovered" phrase here so the alert still fires.
    log.error(`Crawl cycle failed before crawling`, err)
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
