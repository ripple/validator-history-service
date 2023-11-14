import 'dotenv/config'

import { rippleTimeToUnixTime } from 'xrpl'

import { query } from './utils'
import { AmendmentEnabled, AmendmentsInfo } from '../types'
import logger from '../utils/logger'

import amendmentEnabledData from '../data/amendments_enabled.json'
import amendmentInfoData from '../data/amendments_info.json'

const log = logger({ name: 'database-agreement' })

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
 * Save amendment's info on a network to the database.
 *
 * @param amendmentInfo - The input amendment.
 *
 * @returns Void.
 */
async function saveAmendmentsInfo(
  amendmentInfo: AmendmentsInfo,
): Promise<void> {
  await query('amendments_info')
    .insert(amendmentInfo)
    .onConflict(['id'])
    .merge()
    .catch((err) => log.error('Error Saving Amendment Info', err))
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
 * Add amendments info data from Json file munually to the database.
 *
 * @returns Void.
 */
async function addAmendmentsInfoFromJSON(): Promise<void> {
  log.info('Adding Amendments Information from JSON File...')
  const data = amendmentInfoData
  data.forEach(async (amendmentInfo: AmendmentsInfo) => {
    await saveAmendmentsInfo(amendmentInfo)
  })
  log.info('Finished adding Amendments Information from JSON File.')
}

/**
 * Add enabled amendments data from Json file munually to the database.
 *
 * @returns Void.
 */
async function addAmendmentsEnabledFromJSON(): Promise<void> {
  log.info('Adding Enabled Amendments Data from JSON File...')
  const data = amendmentEnabledData as AmendmentEnabledJson[]
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
  log.info('Finished adding Enabled Amendments Data from JSON File.')
}

export default async function addAmendmentsDataFromJSON(): Promise<void> {
  await addAmendmentsInfoFromJSON()
  await addAmendmentsEnabledFromJSON()
}
