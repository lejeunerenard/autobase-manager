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

    const managerA = new AutobaseManager(baseA, () => true,
      storeA.get.bind(storeA), storeA.storage)
    managerA.attachStream(streamA.noiseStream)
    const managerB = new AutobaseManager(baseB, () => true,
      storeB.get.bind(storeB), storeB.storage)
    managerB.attachStream(streamB.noiseStream)

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

    const managerA = new AutobaseManager(baseA, () => true,
      storeA.get.bind(storeA), storeA.storage)
    managerA.attachStream(streamA.noiseStream)
    const managerB = new AutobaseManager(baseB, () => true,
      storeB.get.bind(storeB), storeB.storage)
    managerB.attachStream(streamB.noiseStream)

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

    const managerA = new AutobaseManager(baseA, () => true,
      storeA.get.bind(storeA), storeA.storage)
    managerA.attachStream(streamA.noiseStream)
    const managerB = new AutobaseManager(baseB, () => true,
      storeB.get.bind(storeB), storeB.storage)
    managerB.attachStream(streamB.noiseStream)

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

  t.test('3way replicates', async (t) => {
    t.plan(1)
    const [storeA, baseA] = await create()
    const [storeB, baseB] = await create()
    const [storeC, baseC] = await create()

    const streamA = storeA.replicate(true)
    const streamB = storeB.replicate(false)
    const streamAforC = storeA.replicate(true)
    const streamC = storeC.replicate(false)

    const managerA = new AutobaseManager(baseA, () => true,
      storeA.get.bind(storeA), storeA.storage)
    managerA.attachStream(streamA.noiseStream)
    managerA.attachStream(streamAforC.noiseStream)
    const managerB = new AutobaseManager(baseB, () => true,
      storeB.get.bind(storeB), storeB.storage)
    managerB.attachStream(streamB.noiseStream)
    const managerC = new AutobaseManager(baseC, () => true,
      storeC.get.bind(storeB), storeC.storage)
    managerC.attachStream(streamC.noiseStream)

    pipeline([
      streamAforC,
      streamC,
      streamAforC
    ])

    pipeline([
      streamA,
      streamB,
      streamA
    ])

    await new Promise((resolve) => { setTimeout(resolve, 100) })
    t.deepEqual(baseB.outputs.map((core) => core.key),
      [baseB.localOutput, baseA.localOutput, baseC.localOutput].map((core) => core.key),
      'baseB got baseC\'s localOutput w/o direct stream')
  })

  t.test('filters input & output cores w/ allow function', async (t) => {
    t.plan(2)
    const [storeA, baseA] = await create()
    const [storeB, baseB] = await create()

    const falseCore = await storeA.get(Buffer.from('deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef', 'hex'))
    const falseCore2 = await storeA.get(Buffer.from('feebdaedfeebdaedfeebdaedfeebdaedfeebdaedfeebdaedfeebdaedfeebdaed', 'hex'))
    await baseA.addInput(falseCore)
    await baseB.addOutput(falseCore2)

    const streamA = storeA.replicate(true)
    const streamB = storeB.replicate(false)

    const denyList = [
      falseCore.key.toString('hex'),
      falseCore2.key.toString('hex')
    ]

    function allow (key) {
      return denyList.indexOf(key) === -1
    }

    const managerA = new AutobaseManager(baseA, allow, storeA.get.bind(storeA),
      storeA.storage)
    managerA.attachStream(streamA.noiseStream)
    const managerB = new AutobaseManager(baseB, allow, storeB.get.bind(storeB),
      storeB.storage)
    managerB.attachStream(streamB.noiseStream)

    pipeline([
      streamA,
      streamB,
      streamA
    ])

    await new Promise((resolve) => { setTimeout(resolve, 100) })
    t.deepEqual(baseB.inputs.map((core) => core.key),
      [baseB.localInput, baseA.localInput].map((core) => core.key),
      'baseB got baseA\'s inputs & not denied cores')
    t.deepEqual(baseA.outputs.map((core) => core.key),
      [baseA.localOutput, baseB.localOutput].map((core) => core.key),
      'baseA got baseB\'s outputs & not denied cores')
  })

  t.test('removes stream on close', async (t) => {
    t.plan(4)
    const [storeA, baseA] = await create()
    const [storeB, baseB] = await create()

    const streamA = storeA.replicate(true)
    const streamB = storeB.replicate(false)

    const managerA = new AutobaseManager(baseA, () => true,
      storeA.get.bind(storeA), storeA.storage)
    managerA.attachStream(streamA.noiseStream)
    const managerB = new AutobaseManager(baseB, () => true,
      storeB.get.bind(storeB), storeB.storage)
    managerB.attachStream(streamB.noiseStream)

    pipeline([
      streamA,
      streamB,
      streamA
    ])

    await new Promise((resolve) => { setTimeout(resolve, 100) })

    t.equal(managerA._streams[0].stream, streamA.noiseStream, 'adds stream')
    t.equal(managerB._streams[0].stream, streamB.noiseStream, 'adds stream')

    streamA.destroy()
    streamB.destroy()

    await new Promise((resolve) => { setTimeout(resolve, 100) })

    t.deepEqual(managerA._streams, [], 'removes all streams')
    t.deepEqual(managerB._streams, [], 'removes all streams')
  })
})
