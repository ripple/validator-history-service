import config from '../utils/config'

interface Network {
  id: string
  port?: number
  entry: string
  unls: string[]
}

// put the UNL you want to prioritize at the front
const mainMainnetUnls = ['vl.ripple.com', 'vl.xrplf.org', 'vl.coil.com']
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

const networks: Network[] = [
  {
    id: 'main',
    entry: config.mainnet_p2p_server,
    port: 51235,
    unls: mainnetUnls,
  },
  {
    id: 'test',
    entry: 's.altnet.rippletest.net',
    port: 51235,
    unls: ['vl.altnet.rippletest.net'],
  },
  {
    id: 'dev',
    entry: 's.devnet.rippletest.net',
    port: 51235,
    unls: ['vl.devnet.rippletest.net'],
  },
  {
    id: 'nft-dev',
    entry: 'xls20-sandbox.rippletest.net',
    port: 51235,
    unls: ['nftvalidators.s3.us-west-2.amazonaws.com/index.json'],
  },
  {
    id: 'amm-dev',
    entry: 'amm.devnet.rippletest.net',
    port: 51235,
    unls: ['vlamm.devnet.rippletest.net'],
  },
]

export default networks

export { Network }
