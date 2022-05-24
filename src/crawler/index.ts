import 'dotenv/config'
import moment from 'moment'

import { setupTables, getNetworks } from '../shared/database'
import logger from '../shared/utils/logger'

import Crawler from './crawl'
import locate from './locate'

const log = logger({ name: 'crawler-start' })
const LOCATE_INTERVAL = 24 * 60 * 60 * 1000
const CRAWL_INTERVAL = 2 * 60 * 1000

async function crawl(): Promise<void> {
  const crawlers: Crawler[] = []
  const startCrawl = moment.utc()
  const promises = []
  const networks = await getNetworks()
  for (const entry of networks) {
    const crawler = new Crawler()
    crawlers.push(crawler)
    promises.push(crawler.crawl(entry))
  }
  await Promise.all(promises)

  const duration = moment.utc().diff(startCrawl) / 1000
  const peers = crawlers.reduce(
    (size, crawler) => crawler.publicKeysSeen.size + size,
    0,
  )
  log.info(`Crawl took ${duration} seconds, ${peers} peers discovered`)
}

async function start(): Promise<void> {
  await setupTables()
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

if (typeof require !== 'undefined' && require.main === module) {
  main().catch((err: Error) => log.error(`${err.message}`))
}
