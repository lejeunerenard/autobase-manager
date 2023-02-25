import { AutobaseManager } from '../index.js'
import Corestore from 'corestore'
import Hyperswarm from 'hyperswarm'
import Autobase from 'autobase'
import crypto from 'crypto'

const corestore = new Corestore('./basic-example')
await corestore.ready()

const mine = corestore.namespace('inputs').get({ name: 'input' })
const output = corestore.namespace('outputs').get({ name: 'output' })
await mine.ready()
await output.ready()
const base = new Autobase({
  inputs: [mine],
  localInput: mine,
  localOutput: output
})

// Create manager & ensure its ready
const manager = new AutobaseManager(
  // Autobase to manage
  base,
  // allow() to filter core keys
  () => true,
  // Get function for a hypercore given a key
  corestore.get.bind(corestore),
  // Storage for managing autobase keys
  corestore.storage)
await manager.ready()

// Create connection to attach to
const swarm = new Hyperswarm()
swarm.on('connection', (conn, info) => {
  console.log('found peer', info.publicKey.toString('hex').slice(-6))
  const stream = corestore.replicate(conn)

  // Attach manager
  manager.attachStream(stream)
})
const topic = crypto.createHash('sha256')
  .update('autobase-manager-test')
  .digest()
swarm.join(topic)
