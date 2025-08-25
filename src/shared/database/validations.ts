import { query } from './utils'
import logger from '../utils/logger'

const log = logger({ name: 'database' })

export async function saveValidation(validation: any): Promise<void> {
  let validation_message_data = validation
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
