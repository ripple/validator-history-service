import 'dotenv/config'

import Crawler from '../crawler/crawl'
import { setupTables } from '../shared/database'
import networks from '../shared/utils/networks'

import agreement from './agreement'
import startConnections from './connections'
import { doManifestJobs } from './manifests'

async function start(): Promise<void> {
  await setupTables()
  // Migrate manifests from the legacy database. This will be removed once the service has collected enough manifests.
  // await migrate()
  const promises = []
  for (const entry of networks) {
    const crawler = new Crawler()
    promises.push(crawler.crawl(entry))
  }
  await Promise.all(promises)
  await startConnections()
  await doManifestJobs()
  agreement.start()
}

void start()
