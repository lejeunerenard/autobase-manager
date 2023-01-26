import test from 'tape'
import RAM from 'random-access-memory'
import Corestore from 'corestore'
import Autobase from 'autobase'
import { AutobaseManager } from '../index.js'
import { pipeline } from 'streamx'

async function create (storage) {
  const store = new Corestore(storage || RAM)
  await store.ready()

  const core = store.get({ name: 'my-input' })
  const coreOut = store.get({ name: 'my-output' })
  const base = new Autobase({
    inputs: [core],
    localInput: core,
    outputs: [coreOut],
    localOutput: coreOut,
    autostart: true,
    eagerUpdate: true
  })

  await base.ready()

  return [store, base]
}

test('full replicate', (t) => {
  t.test('adds localInputs between autobases', async (t) => {
    t.plan(1)
    const [storeA, baseA] = await create()
    const [storeB, baseB] = await create()

    const streamA = storeA.replicate(true)
    const streamB = storeB.replicate(false)

    const managerA = new AutobaseManager(streamA.noiseStream, baseA,
      () => true, storeA.get.bind(storeA))
    const managerB = new AutobaseManager(streamB.noiseStream, baseB,
      () => true, storeB.get.bind(storeB))

    pipeline([
      streamA,
      streamB,
      streamA
    ])

    await new Promise((resolve) => { setTimeout(resolve, 100) })
    t.deepEqual(baseB.inputs.map((core) => core.key),
      [baseB.localInput, baseA.localInput].map((core) => core.key),
      'baseB got baseA\'s localinput')
  })

  t.test('adds inputs not own by either autobase but known by one', async (t) => {
    t.plan(1)
    const [storeA, baseA] = await create()
    const [storeB, baseB] = await create()

    const falseCore = await storeA.get(Buffer.from('deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef', 'hex'))
    await baseA.addInput(falseCore)

    const streamA = storeA.replicate(true)
    const streamB = storeB.replicate(false)

    const managerA = new AutobaseManager(streamA.noiseStream, baseA,
      () => true, storeA.get.bind(storeA))
    const managerB = new AutobaseManager(streamB.noiseStream, baseB,
      () => true, storeB.get.bind(storeB))

    pipeline([
      streamA,
      streamB,
      streamA
    ])

    await new Promise((resolve) => { setTimeout(resolve, 100) })
    t.deepEqual(baseB.inputs.map((core) => core.key),
      [baseB.localInput, baseA.localInput, falseCore].map((core) => core.key),
      'baseB got baseA\'s localInput & the unowned ocer')
  })

  t.test('adds outputs not own by either autobase but known by one', async (t) => {
    t.plan(1)
    const [storeA, baseA] = await create()
    const [storeB, baseB] = await create()

    const falseCore = await storeA.get(Buffer.from('deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef', 'hex'))
    await baseA.addOutput(falseCore)

    const streamA = storeA.replicate(true)
    const streamB = storeB.replicate(false)

    const managerA = new AutobaseManager(streamA.noiseStream, baseA,
      () => true, storeA.get.bind(storeA))
    const managerB = new AutobaseManager(streamB.noiseStream, baseB,
      () => true, storeB.get.bind(storeB))

    pipeline([
      streamA,
      streamB,
      streamA
    ])

    await new Promise((resolve) => { setTimeout(resolve, 100) })
    t.deepEqual(baseB.outputs.map((core) => core.key),
      [baseB.localOutput, baseA.localOutput, falseCore].map((core) => core.key),
      'baseB got baseA\'s localOutput & the unowned core')
  })
})
