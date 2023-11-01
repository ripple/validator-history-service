import config from '../utils/config'

interface DefinedNetwork {
  json: number
  port?: number
  entry: string
  unls: string[]
}

interface Network {
  id: number
  port?: number
  entry: string
  unls: string[]
}

// put the UNL you want to prioritize at the front
const mainMainnetUnls = ['vl.ripple.com', 'vl.xrplf.org']
let mainnetUnls
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

const networks: DefinedNetwork[] = [
  {
    entry: config.mainnet_p2p_server,
    json: 51234,
    port: 51235,
    unls: mainnetUnls,
  },
  {
    entry: 's.altnet.rippletest.net',
    json: 51234,
    port: 51235,
    unls: ['vl.altnet.rippletest.net'],
  },
  {
    entry: 's.devnet.rippletest.net',
    json: 51234,
    port: 51235,
    unls: ['vl.devnet.rippletest.net'],
  },
  {
    entry: 'xahau-test.net',
    json: 80,
    port: 443,
    unls: ['vl3.beta.bithomp.com'],
  },
]

export default networks

export { Network }
