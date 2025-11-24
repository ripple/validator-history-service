import logger from '../utils/logger'

import { query } from './utils'

const log = logger({ name: 'database' })

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access,
@typescript-eslint/no-unsafe-assignment -- test has undocumented fields */

/**
 * Save a validation to the database.
 *
 * @param validation - Validation to save.
 */
// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types -- validation-stream has undocumented fields
export default async function saveValidation(validation: any): Promise<void> {
  const validation_message_data = validation
  if (validation_message_data.data) {
    delete validation_message_data.data
  }
  if (validation_message_data.amendments) {
    delete validation_message_data.amendments
  }
  if (validation_message_data.ledger_fee) {
    delete validation_message_data.ledger_fee
  }
  // to save space, we don't need the serialized data field
  delete validation_message_data.data
  delete validation_message_data.amendments
  delete validation_message_data.ledger_fee

  await query('validations')
    .insert(validation_message_data)
    .onConflict('signature')
    .ignore()
    .catch((err) => {
      log.error('Error Saving Validation: ', err)
    })
}
/* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access,
@typescript-eslint/no-unsafe-assignment -- end of the test */
