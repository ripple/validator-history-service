import 'dotenv/config'

import Crawler from '../crawler/crawl'
import { setupTables, getNetworks } from '../shared/database'

import agreement from './agreement'
import startConnections from './connections'
import { doManifestJobs } from './manifests'

async function start(): Promise<void> {
  await setupTables()
  // Migrate manifests from the legacy database. This will be removed once the service has collected enough manifests.
  // await migrate()
  const promises = []
  const networks = await getNetworks()
  for (const network of networks) {
    const crawler = new Crawler()
    promises.push(crawler.crawl(network))
  }
  await Promise.all(promises)
  await startConnections()
  await doManifestJobs()
  agreement.start()
}

if (typeof require !== 'undefined' && require.main === module) {
  void start()
}
