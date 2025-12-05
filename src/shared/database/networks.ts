import config from '../utils/config'

interface Network {
  id: string
  port?: number
  entry: string
  unls: string[]
  // Context about the network_id field in rippled: https://xrpl.org/docs/references/protocol/transactions/common-fields#networkid-field
  network_id: number
}

// put the UNL you want to prioritize at the front
const mainMainnetUnls = ['vl.ripple.com', 'vl.xrplf.org']
let mainnetUnls: string[]
if (config.mainnet_unl == null) {
  mainnetUnls = mainMainnetUnls
} else {
  mainnetUnls = [config.mainnet_unl]
  mainMainnetUnls.forEach((unl) => {
    if (unl !== config.mainnet_unl) {
      mainnetUnls.push(unl)
    }
  })
}

const networks: Network[] = [
  {
    id: 'main',
    entry: config.mainnet_p2p_server,
    port: 51235,
    unls: mainnetUnls,
    network_id: 0,
  },
  {
    id: 'test',
    entry: 's.altnet.rippletest.net',
    port: 51235,
    unls: ['vl.altnet.rippletest.net'],
    network_id: 1,
  },
  {
    id: 'dev',
    entry: 's.devnet.rippletest.net',
    port: 51235,
    unls: ['vl.devnet.rippletest.net'],
    network_id: 2,
  },
  {
    id: 'amm-dev',
    entry: 'amm.devnet.rippletest.net',
    port: 51235,
    unls: ['vlamm.devnet.rippletest.net'],
    network_id: 25,
  },
  {
    id: 'xahau-main',
    entry: 'xahau.network',
    port: 443,
    unls: ['vl.xahau.org'],
    network_id: 21337,
  },
  {
    id: 'xahau-test',
    entry: 'xahau-test.net',
    port: 443,
    unls: ['vl3.beta.bithomp.com'],
    network_id: 21338,
  },
]

export default networks

export { Network }
