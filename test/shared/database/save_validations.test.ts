import {
  destroy,
  query,
  setupTables,
  tearDown,
} from '../../../src/shared/database'
import saveValidation from '../../../src/shared/database/validations'
import { ValidationRaw } from '../../../src/shared/types'
import validations from '../../connections/fixtures/validation-stream.json'

describe('test insertion into validations table', () => {
  beforeEach(async () => {
    await query('validations').truncate()
  })

  afterEach(async () => {
    await query('validations').truncate()
  })

  beforeAll(async () => {
    await tearDown()
    await setupTables()
  })

  afterAll(async () => {
    await tearDown()
    await destroy()
  })

  it('save unique validations', async () => {
    for (const val of validations) {
      await saveValidation(val as ValidationRaw)
    }

    const insertedVal = (await query('validations').select(
      '*',
    )) as ValidationRaw[]
    expect(insertedVal.length).toBe((validations as ValidationRaw[]).length)
  })

  it('saving validations with the same signature should not insert a duplicate', async () => {
    await saveValidation(validations[0] as ValidationRaw)

    const insertedVal = (await query('validations').select(
      '*',
    )) as ValidationRaw[]
    expect(insertedVal.length).toBe(1)

    await saveValidation(validations[0] as ValidationRaw)

    const insertedVal2 = (await query('validations').select(
      '*',
    )) as ValidationRaw[]
    expect(insertedVal2.length).toBe(1)
  })
})
