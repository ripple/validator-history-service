import { setupTables, destroy, query } from '../../src/shared/database'
import networks, { Network } from '../../src/shared/database/networks'

describe('setupNetworksTable', () => {
  beforeAll(async () => {
    await query('networks').delete('*')
  })

  afterAll(async () => {
    await destroy()
  })

  beforeEach(async () => {
    // Clean up networks table before each test
    await query('networks').delete('*')
  })

  test('should create networks table and insert all default networks', async () => {
    await setupTables()

    const storedNetworks: Network[] = (await query('networks').select(
      '*',
    )) as Network[]

    expect(storedNetworks.length).toBe(networks.length)

    // Verify each network was inserted correctly
    networks.forEach((network) => {
      const stored = storedNetworks.find((n: Network) => n.id === network.id)
      expect(stored).toBeDefined()
      expect(stored?.entry).toBe(network.entry)
      expect(stored?.port).toBe(network.port)
      expect(stored?.unls).toBe(network.unls.join(','))
    })
  })

  test('should update test network entry if it differs', async () => {
    // Insert test network with different entry
    await query('networks').insert({
      id: 'test',
      entry: 'old.testnet.example.com',
      port: 51235,
      unls: 'vl.altnet.rippletest.net',
    })

    // Run setupTables
    await setupTables()

    // Verify test network was updated to correct entry
    const testNetwork: Network = (await query('networks')
      .select('*')
      .where('id', '=', 'test')
      .first()) as Network

    const expectedTestNetwork = networks.find((n) => n.id === 'test')
    expect(testNetwork).toBeDefined()
    expect(testNetwork.entry).toBe(expectedTestNetwork?.entry)
    expect(testNetwork.port).toBe(expectedTestNetwork?.port)
    expect(testNetwork.unls).toBe(expectedTestNetwork?.unls.join(','))
  })
})
