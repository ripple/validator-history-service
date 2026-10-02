import {
  EnvironmentVariable,
  getEnvironmentVariable,
  getRequiredEnvironmentVariable,
} from './environment-variable'

type NodeEnv = 'development' | 'production' | 'test'

const nodeEnv = (getEnvironmentVariable(EnvironmentVariable.node_env) ??
  'development') as NodeEnv

// Knex's own pool, which is what saturates under load - not the Postgres
// connection ceiling, which has ample headroom. The knex default of max 10 is
// too small for validation throughput: every validation runs two writes via
// saveValidator, so the pool fills, acquires queue up, and then time out.
const DB_POOL_MIN = 2
const DB_POOL_MAX = 20

const db = {
  client: getEnvironmentVariable(EnvironmentVariable.db) ?? 'pg',
  connection: {
    host: getEnvironmentVariable(EnvironmentVariable.host),
    user: getRequiredEnvironmentVariable(EnvironmentVariable.user),
    database: getRequiredEnvironmentVariable(EnvironmentVariable.database),
    password: getEnvironmentVariable(EnvironmentVariable.password),
  },
  pool: { min: DB_POOL_MIN, max: DB_POOL_MAX },
  // Fail fast rather than queueing. At the previous 2 minute timeout a backlog
  // could grow enormous before anything surfaced, which made a transient spike
  // look like a hard outage - https://knexjs.org/guide/#acquireconnectiontimeout
  acquireConnectionTimeout: parseInt(
    getEnvironmentVariable(EnvironmentVariable.acquireConnectionTimeout) ??
      '30000',
    10,
  ),
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

const mainnet_unl = getEnvironmentVariable(EnvironmentVariable.mainnet_unl)

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
  mainnet_unl,
}

export default config
