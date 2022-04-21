import {
  EnvironmentVariable,
  getEnvironmentVariable,
  getRequiredEnvironmentVariable,
} from './environment-variable'

type NodeEnv = 'development' | 'production' | 'test'

const nodeEnv = (getEnvironmentVariable(EnvironmentVariable.node_env) ??
  'development') as NodeEnv

const db = {
  client: getEnvironmentVariable(EnvironmentVariable.db) ?? 'pg',
  connection: {
    host: getEnvironmentVariable(EnvironmentVariable.host),
    user: getRequiredEnvironmentVariable(EnvironmentVariable.user),
    database: getRequiredEnvironmentVariable(EnvironmentVariable.database),
    password: getEnvironmentVariable(EnvironmentVariable.password),
  },
}

const maxmind = {
  user: getEnvironmentVariable(EnvironmentVariable.maxmind_user),
  key: getEnvironmentVariable(EnvironmentVariable.maxmind_key),
}

const rippled_rpc_admin_server = getRequiredEnvironmentVariable(
  EnvironmentVariable.rippled_rpc_admin_server,
)

const mainnet_p2p_server = getRequiredEnvironmentVariable(
  EnvironmentVariable.mainnet_p2p_server,
)

const port = getEnvironmentVariable(EnvironmentVariable.port)

const addr = getEnvironmentVariable(EnvironmentVariable.addr)

const config = {
  nodeEnv,
  db,
  maxmind,
  rippled_rpc_admin_server,
  port,
  addr,
  mainnet_p2p_server,
}

export default config
