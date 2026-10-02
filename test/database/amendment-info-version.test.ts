import { destroy, query, setupTables } from '../../src/shared/database'
import { saveAmendmentInfo } from '../../src/shared/database/amendments'
import { AmendmentInfo } from '../../src/shared/types'

const ID = '14A2B45E48A4A124D1BBA657AC7B0DC3D5EA8C256C89E8F0D8142D32960A7944'

describe('amendment rippled_version persistence', () => {
  beforeAll(async () => {
    await setupTables()
  })

  afterAll(async () => {
    await query('amendments_info').delete('*')
    await destroy()
  })

  beforeEach(async () => {
    await query('amendments_info').delete('*')
  })

  it('does not null a stored rippled_version when none is supplied', async () => {
    await saveAmendmentInfo({
      id: ID,
      name: 'fixBatchV1_2',
      rippled_version: '3.4.1',
      retired: false,
      obsolete: false,
    })

    // A later cycle where the version is unknown must leave the stored value
    // alone. saveAmendmentInfo merges, so a `rippled_version: undefined` here
    // would be written as SQL DEFAULT (null).
    const withoutVersion: AmendmentInfo = {
      id: ID,
      name: 'fixBatchV1_2',
      retired: false,
      obsolete: false,
    }
    await saveAmendmentInfo(withoutVersion)

    const rows = (await query('amendments_info')
      .select('rippled_version')
      .where({ id: ID })) as Array<{ rippled_version: string | null }>

    expect(rows[0].rippled_version).toBe('3.4.1')
  })

  it('DOES null it when the key is present but undefined', async () => {
    // This is the distinction fetchAmendmentInfo's guard relies on: knex omits
    // an absent key from the merge, but writes a present-and-undefined one as
    // SQL DEFAULT. Assigning `rippled_version` unconditionally would therefore
    // wipe the patched value whenever the upstream source has none.
    await saveAmendmentInfo({
      id: ID,
      name: 'fixBatchV1_2',
      rippled_version: '3.4.1',
      retired: false,
      obsolete: false,
    })

    await saveAmendmentInfo({
      id: ID,
      name: 'fixBatchV1_2',
      rippled_version: undefined,
      retired: false,
      obsolete: false,
    })

    const rows = (await query('amendments_info')
      .select('rippled_version')
      .where({ id: ID })) as Array<{ rippled_version: string | null }>

    expect(rows[0].rippled_version).toBeNull()
  })
})
