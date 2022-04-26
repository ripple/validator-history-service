/**
 * An enum containing the environment variables defined in .env.
 */
export enum EnvironmentVariable {
  maxmind_user = 'MAXMIND_USER',
  maxmind_key = 'MAXMIND_KEY',
  node_env = 'NODE_ENV',
  db = 'DB_CLIENT',
  host = 'DB_HOST',
  user = 'DB_USER',
  database = 'DB_DATABASE',
  password = 'DB_PASSWORD',
  rippled_rpc_admin_server = 'RIPPLED_RPC_ADMIN',
  port = 'PORT',
  addr = 'ADDR',
  mainnet_p2p_server = 'MAINNET_P2P_ENTRY',
  mainnet_unl = 'MAINNET_UNL',
}

/**
 * Returns the value of an env var defined in .env.
 *
 * @param environmentVariable - The environment variable to look up.
 * @returns The value for the environment variable or undefined if no value is set.
 */
export function getEnvironmentVariable(
  environmentVariable: EnvironmentVariable,
): string | undefined {
  // eslint-disable-next-line node/no-process-env -- This is the one spot where we allow access to process.env
  const envVar = process.env[environmentVariable]
  if (!envVar) {
    return undefined
  }
  return envVar
}

/**
 * A Set containing all of the environment variables required by the server to run.
 * Examples of these should be provided in .env.example.
 */
const requiredEnvironmentVariables = new Set([
  EnvironmentVariable.user,
  EnvironmentVariable.database,
  EnvironmentVariable.rippled_rpc_admin_server,
  EnvironmentVariable.port,
  EnvironmentVariable.addr,
  EnvironmentVariable.mainnet_p2p_server,
])

/**
 * Returns the value of an env var defined in .env that the server needs to run.
 * Examples of these should be provided in .env.example.
 *
 * @param environmentVariable - The environment variable to look up.
 * @returns The value for the environment variable, or throws an Error if not set
 * in .env.
 * @throws When required environment variables are not found.
 */
export function getRequiredEnvironmentVariable(
  environmentVariable: EnvironmentVariable,
): string {
  if (!requiredEnvironmentVariables.has(environmentVariable)) {
    throw new Error(
      `Environment variable ${environmentVariable} is not defined as required in env.requiredEnvironmentVariables`,
    )
  }

  const value = getEnvironmentVariable(environmentVariable)
  if (typeof value === 'undefined') {
    throw new Error(
      `Required environment variable ${environmentVariable} is not defined in .env; check .env.example for instructions`,
    )
  }

  return value
}
