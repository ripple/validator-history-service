import 'dotenv/config'

import Crawler from '../crawler/crawl'
import { setupTables, getNetworks } from '../shared/database'

import agreement from './agreement'
import fetchAmendmentInfo from './amendments'
import startConnections from './connections'
import { doManifestJobs } from './manifests'
import addAmendmentsDataFromJSON from './update-amendments-from-json'

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
  await addAmendmentsDataFromJSON()
  await doManifestJobs()
  agreement.start()
  await fetchAmendmentInfo()
}

void start()
