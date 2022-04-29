import config from './config'

interface Network {
  network: string
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
    network: 'main',
    entry: config.mainnet_p2p_server,
    port: 51235,
    unls: mainnetUnls,
  },
  {
    network: 'test',
    entry: 's.altnet.rippletest.net',
    port: 51235,
    unls: ['vl.altnet.rippletest.net'],
  },
  {
    network: 'dev',
    entry: 's.devnet.ripple.test.net',
    port: 51235,
    unls: ['vl.devnet.rippletest.net'],
  },
]

export default networks

export { Network }
