import 'dotenv/config'
import * as fs from 'fs'

import { rippleTimeToUnixTime } from 'xrpl'

import { query } from '../shared/database/utils'
import { AmendmentEnabled } from '../shared/types'
import logger from '../shared/utils/logger'

const log = logger({ name: 'database-agreement' })
const filePath = 'src/shared/data/amendments_enabled.json'

interface AmendmentEnabledJson {
  networks: string
  amendments: Array<{
    id: string
    ledger_index: number
    tx_hash: string
    date: number
  }>
}

/**
 * Save amendment enabled on a network to the database.
 *
 * @param enabledAmendment - The input amendment.
 *
 * @returns Void.
 */
async function saveAmendmentsEnabled(
  enabledAmendment: AmendmentEnabled,
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
export default async function addAmendmentsDataFromJSON(): Promise<void> {
  log.info('Adding Enabled Amendment Data from JSON File...')
  const jsonData = await fs.promises.readFile(filePath, 'utf8')
  const data: AmendmentEnabledJson[] = JSON.parse(jsonData)
  data.forEach((networkData: AmendmentEnabledJson) => {
    networkData.amendments.forEach(async (amendment) => {
      const enabledData: AmendmentEnabled = {
        amendment_id: amendment.id,
        networks: networkData.networks,
        ledger_index: amendment.ledger_index,
        tx_hash: amendment.tx_hash,
        date: new Date(rippleTimeToUnixTime(amendment.date)),
      }
      await saveAmendmentsEnabled(enabledData)
    })
  })
  log.info('Finished adding Enabled Amendment Data from JSON File.')
}
