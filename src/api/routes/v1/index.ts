import { Router as createRouter, Request, Response } from 'express'

import handleDailyScores from './daily-report'
import handleValidatorManifest from './manifests'
import { handleNode, handleNodes, handleTopology } from './nodes'
import { handleValidator, handleValidators } from './validator'
import handleValidatorReport from './validator-report'
import handleHealth from './health'

const api = createRouter()
api.use('/health', handleHealth)
api.use('/network/validator_reports', handleDailyScores)
api.use('/network/topology/nodes/:publicKey', handleNode)
api.use('/network/topology/nodes', handleNodes)
api.use('/network/topology', handleTopology)
api.use('/network/validators/:publicKey/manifests', handleValidatorManifest)
api.use('/network/validators/:publicKey/reports', handleValidatorReport)
api.use('/network/validators/:publicKey', handleValidator)
api.use('/network/validators', handleValidators)

export default api
