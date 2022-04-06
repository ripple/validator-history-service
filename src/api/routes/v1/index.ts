import { Router as createRouter } from 'express'

import handleDailyScores from './daily-report'
import handleHealth from './health'
import handleValidatorManifest from './manifests'
import { handleNode, handleNodes, handleTopology } from './nodes'
import { handleValidator, handleValidators } from './validator'
import handleValidatorReport from './validator-report'

const api = createRouter()
api.use('/health', handleHealth)

api.use('/network/topology', handleTopology)
api.use('/network/topology/nodes', handleNodes)
api.use('/network/topology/nodes/:publicKey', handleNode)

api.use('/network/validators', handleValidators)
api.use('/network/validators/:publicKey', handleValidator)
api.use('/network/validators/:publicKey/manifests', handleValidatorManifest)
api.use('/network/validators/:publicKey/reports', handleValidatorReport)

api.use('/network/validator_reports', handleDailyScores)

export default api
