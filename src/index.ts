/* eslint-disable import/no-unassigned-import -- main file */
/* eslint-disable import/unambiguous -- main file */
/* eslint-disable global-require, node/global-require -- main file */
/* eslint-disable @typescript-eslint/no-require-imports -- main file */
if (process.argv.includes('--api')) {
  require('./api')
} else if (process.argv.includes('--connections')) {
  require('./connection-manager')
} else if (process.argv.includes('--crawler')) {
  require('./crawler')
} else {
  throw new Error(
    `Invalid argument. Use '--api', '--connections' or '--crawler'`,
  )
}
