import { Request, Response } from 'express'
import { query } from '../../../shared/database'

export default async function handleHealth(_u: Request, res: Response):Promise<void>{
    try {
        const count = await query('crawls')
            .count('*')
            .where('connected', '=', true)

        res.status(200).send(count[0])
    } catch {
        res.send({ result: 'error', message: 'internal error' })
    }
   
}