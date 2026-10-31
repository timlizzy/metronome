import express from 'express'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const app = express()

app.use(express.static(join(__dirname, 'public')))

app.listen(3000, () => {
  console.log('Metronome running at http://localhost:3000')
})
