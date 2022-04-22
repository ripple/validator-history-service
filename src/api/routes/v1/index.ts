import { Router as createRouter } from 'express'

import handleDailyScores from './daily-report'
import handleHealth from './health'
import handleValidatorManifest from './manifests'
import { handleNode, handleNodes, handleTopology } from './nodes'
import { handleValidator, handleValidators } from './validator'
import handleValidatorReport from './validator-report'

const api = createRouter()

api.use('/health', handleHealth)
api.use('/network/validator_reports', handleDailyScores)
api.use('/network/topology', handleTopology)

api.use('/network/topology/nodes/:publicKey', handleNode)
api.use('/network/topology/nodes', handleNodes)
// ^ This will be replaced - copied for easier migration
api.use('/network/topology/node/:publicKey', handleNode)

api.use('/network/validators/:publicKey/reports', handleValidatorReport)
api.use('/network/validators/:publicKey/manifests', handleValidatorManifest)
api.use('/network/validators/:publicKey', handleValidator)
api.use('/network/validators', handleValidators)
// ^ These will be replaced - copied for easier migration
api.use('/network/validator/:publicKey', handleValidator)
api.use('/network/validator/:publicKey/reports', handleValidatorReport)
api.use('/network/validator/:publicKey/manifests', handleValidatorManifest)

export default api
