import { setupTables } from '../../../src/shared/database'
import { destroy, query, tearDown } from '../../../src/shared/database/utils'
import { insertValidatedLedger, insertValidations, ValidatedLedger } from '../../../src/shared/database/validatedLedgers'
import { StreamLedger } from '../../../src/shared/types'


describe('insert validations into the validated_ledgers table', () => {
  const mockLedger: StreamLedger = {
    type: 'ledgerClosed',
    ledger_index: 98313833,
    ledger_hash:
      '34F133C16E49FDB91E3BA6C59CCF9AD7F48BBDEFEB4277FF77C41367AA16FEBE',
    ledger_time: 809104601,
    fee_base: 10,
    reserve_base: 1000000,
    reserve_inc: 200000,
    validated_ledgers: '32570-98313833',
    txn_count: 106,
  }

  beforeAll(async () => {
    await tearDown()
    await setupTables()
    // await flushPromises()
  })

  afterAll(async () => {
    await tearDown()
    await destroy()
  })

  beforeEach(async () => {
    await query('validated_ledgers').delete('*')
  })

  afterEach(async () => {
    await query('validated_ledgers').delete('*')
  })


  it(`insert three validations`, async () => {
    // insert a validated ledger into the table
    await insertValidatedLedger('main', mockLedger)

    // insert validations into the table
    await insertValidations(mockLedger.ledger_hash, mockLedger.ledger_index, ['VALIDATOR1'], 'main')
    // expect the validated_ledgers table to have 1 entry
    let validatedLedgers: ValidatedLedger[] = (await query('validated_ledgers').select('*')) as ValidatedLedger[]
    expect(validatedLedgers.length).toBe(1)
    expect(validatedLedgers[0].validation_public_keys).toEqual(['VALIDATOR1'])

    // insert the second validation into the validated_ledgers table
    await insertValidations(mockLedger.ledger_hash, mockLedger.ledger_index, ['VALIDATOR2'], 'main')
    // expect to observe 2 validations
    validatedLedgers = (await query('validated_ledgers').select('*').where('ledger_hash', mockLedger.ledger_hash).andWhere('ledger_index', mockLedger.ledger_index).andWhere('network', 'main')) as ValidatedLedger[]
    expect(validatedLedgers.length).toBe(1)
    expect(validatedLedgers[0].validation_public_keys.length).toBe(2)

    expect(validatedLedgers[0].validation_public_keys).toContain('VALIDATOR1')
    expect(validatedLedgers[0].validation_public_keys).toContain('VALIDATOR2')

    // insert the third validation into the validated_ledgers table
    await insertValidations(mockLedger.ledger_hash, mockLedger.ledger_index, ['VALIDATOR3'], 'main')
    // expect to observe 3 validations
    validatedLedgers = (await query('validated_ledgers').select('*').where('ledger_hash', mockLedger.ledger_hash).andWhere('ledger_index', mockLedger.ledger_index).andWhere('network', 'main')) as ValidatedLedger[]
    expect(validatedLedgers.length).toBe(1)
    expect(validatedLedgers[0].validation_public_keys.length).toBe(3)
    expect(validatedLedgers[0].validation_public_keys).toContain('VALIDATOR1')
    expect(validatedLedgers[0].validation_public_keys).toContain('VALIDATOR2')
    expect(validatedLedgers[0].validation_public_keys).toContain('VALIDATOR3')
  })

  it(`insert duplicate validations`, async() => {
    // insert a validated ledger into the table
    await insertValidatedLedger('main', mockLedger)

    // insert validations into the table
    await insertValidations(mockLedger.ledger_hash, mockLedger.ledger_index, ['VALIDATOR1', 'VALIDATOR2'], 'main')
    // expect the validated_ledgers table to have 1 entry
    let validatedLedgers: ValidatedLedger[] = (await query('validated_ledgers').select('*')) as ValidatedLedger[]
    expect(validatedLedgers.length).toBe(1)
    expect(validatedLedgers[0].validation_public_keys.length).toBe(2)
    expect(validatedLedgers[0].validation_public_keys).toContain('VALIDATOR1')
    expect(validatedLedgers[0].validation_public_keys).toContain('VALIDATOR2')

    // insert duplicate validations into the validated_ledgers table
    await insertValidations(mockLedger.ledger_hash, mockLedger.ledger_index, ['VALIDATOR1', 'VALIDATOR2'], 'main')
    // expect no material changes to the table values
    validatedLedgers = (await query('validated_ledgers').select('*')) as ValidatedLedger[]
    expect(validatedLedgers.length).toBe(1)
    expect(validatedLedgers[0].validation_public_keys.length).toBe(2)
    expect(validatedLedgers[0].validation_public_keys).toContain('VALIDATOR1')
    expect(validatedLedgers[0].validation_public_keys).toContain('VALIDATOR2')


    // insert two duplicate validations and one new validation into the validated_ledgers table
    await insertValidations(mockLedger.ledger_hash, mockLedger.ledger_index, ['VALIDATOR1', 'VALIDATOR2', 'VALIDATOR3'], 'main')
    validatedLedgers = (await query('validated_ledgers').select('*')) as ValidatedLedger[]
    expect(validatedLedgers.length).toBe(1)
    expect(validatedLedgers[0].validation_public_keys.length).toBe(3)
    expect(validatedLedgers[0].validation_public_keys).toContain('VALIDATOR1')
    expect(validatedLedgers[0].validation_public_keys).toContain('VALIDATOR2')
    expect(validatedLedgers[0].validation_public_keys).toContain('VALIDATOR3')
  })
})
