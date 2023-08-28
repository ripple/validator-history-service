import 'dotenv/config'
import * as fs from 'fs'

import logger from '../utils/logger'

import { query } from './utils'

const log = logger({ name: 'database-agreement' })
const filePath = 'src/shared/data/amendments_enabled.json'
const RIPPLE_EPOCH_DIFF = 0x386d4380

interface AmendmentEnabledDb {
  amendment_id: string
  networks: string
  tx_hash: string
  date: Date
}

interface AmendmentEnabledJson {
  networks: string
  amendments: Array<{
    id: string
    networks: string
    tx_hash: string
    date: string | number
  }>
}

/**
 * Convert a ripple timestamp to a unix timestamp.
 *
 * @param rpepoch - (seconds since 1/1/2000 GMT).
 * @returns Milliseconds since unix epoch.
 */
function rippleTimeToUnixTime(rpepoch: number): number {
  return (rpepoch + RIPPLE_EPOCH_DIFF) * 1000
}

/**
 * Save amendment enabled on a network to the database.
 *
 * @param enabledAmendment - The input amendment.
 *
 * @returns Void.
 */
async function saveAmendmentsEnabled(
  enabledAmendment: AmendmentEnabledDb,
): Promise<void> {
  await query('amendments_enabled')
    .insert(enabledAmendment)
    .onConflict(['amendment_id', 'networks'])
    .merge()
    .catch((err) => log.error('Error Saving Enabled Amendment', err))
}

/**
 * Add enabled amendments data from Json file munually to the database.
 *
 * @returns Void.
 */
async function addDataFromJSON(): Promise<void> {
  log.info('Adding Enabled Amendment Data from JSON File...')
  const jsonData = await fs.promises.readFile(filePath, 'utf8')
  const data: AmendmentEnabledJson[] = JSON.parse(jsonData)
  data.forEach((networkData: AmendmentEnabledJson) => {
    networkData.amendments.forEach(async (amendment) => {
      if (typeof amendment.date === 'number') {
        amendment.date = rippleTimeToUnixTime(amendment.date)
      }
      const enabledData: AmendmentEnabledDb = {
        amendment_id: amendment.id,
        networks: networkData.networks,
        tx_hash: amendment.tx_hash,
        date: new Date(amendment.date),
      }
      await saveAmendmentsEnabled(enabledData)
    })
  })
  log.info('Finished Enabled Amendment Data from JSON File.')
}

void addDataFromJSON()
