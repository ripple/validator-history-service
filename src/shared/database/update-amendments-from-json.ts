import { rippleTimeToUnixTime } from 'raj-xrpl'

import amendmentInfoData from '../data/amendments_info.json'
import amendmentStatusData from '../data/amendments_status.json'
import { AmendmentStatus, AmendmentInfo } from '../types'
import logger from '../utils/logger'

import { saveAmendmentInfo } from './amendments'
import { query } from './utils'

const FOURTEEN_DAYS_IN_MILLISECONDS = 14 * 24 * 60 * 60 * 1000

const log = logger({ name: 'database-agreement' })

interface AmendmentStatusJson {
  networks: string
  amendments: Array<{
    id: string
    ledger_index: number
    tx_hash: string
    date?: number
    eta?: number
  }>
}

/**
 * Save amendment Status on a network to the database.
 *
 * @param statusAmendment - The input amendment.
 *
 * @returns Void.
 */
async function saveAmendmentsStatus(
  statusAmendment: AmendmentStatus,
): Promise<void> {
  await query('amendments_status')
    .insert(statusAmendment)
    .onConflict(['amendment_id', 'networks'])
    .merge()
    .catch((err) => log.error('Error Saving Amendment Status', err))
}

/**
 * Add amendments info data from Json file manually to the database.
 *
 * @returns Void.
 */
async function addAmendmentsInfoFromJSON(): Promise<void> {
  log.info('Adding Amendments Information from JSON File...')
  const data = amendmentInfoData
  data.forEach(async (amendmentInfo: AmendmentInfo) => {
    await saveAmendmentInfo(amendmentInfo)
  })
  log.info('Finished adding Amendments Information from JSON File.')
}

/**
 * Add Status amendments data from Json file manually to the database.
 *
 * @returns Void.
 */
async function addAmendmentsStatusFromJSON(): Promise<void> {
  log.info('Adding Amendments Status Data from JSON File...')
  const data = amendmentStatusData as AmendmentStatusJson[]
  data.forEach((networkData: AmendmentStatusJson) => {
    networkData.amendments.forEach(async (amendment) => {
      const statusData: AmendmentStatus = {
        amendment_id: amendment.id,
        networks: networkData.networks,
        ledger_index: amendment.ledger_index,
        tx_hash: amendment.tx_hash,
        date: amendment.date
          ? new Date(rippleTimeToUnixTime(amendment.date))
          : undefined,
        eta: amendment.eta
          ? new Date(
              rippleTimeToUnixTime(amendment.eta) +
                FOURTEEN_DAYS_IN_MILLISECONDS,
            )
          : undefined,
      }
      await saveAmendmentsStatus(statusData)
    })
  })
  log.info('Finished adding Amendments Status Data from JSON File.')
}

export default async function addAmendmentsDataFromJSON(): Promise<void> {
  await addAmendmentsInfoFromJSON()
  await addAmendmentsStatusFromJSON()
}
