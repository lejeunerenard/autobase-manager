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

test('basic usage', (t) => {
  t.test('manager.ready()', (t) => {
    t.test('calls base.ready', async (t) => {
      const store = new Corestore(RAM)
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

      const manager = new AutobaseManager(base, () => true,
        store.get.bind(store), store.storage)
      await manager.ready()

      t.ok(core.key, 'input key is defined')
      t.ok(coreOut.key, 'outupt key is defined')
      t.end()
    })
  })
})

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

  t.test('filters input & output cores w/ async allow function', async (t) => {
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

    async function allow (key) {
      await new Promise((resolve) => setTimeout(resolve, 100))
      return denyList.indexOf(key) === -1
    }

    const managerA = new AutobaseManager(baseA, allow, storeA.get.bind(storeA),
      storeA.storage)
    managerA.attachStream(streamA.noiseStream)
    const managerB = new AutobaseManager(baseB, allow, storeB.get.bind(storeB),
      storeB.storage)
    managerB.attachStream(streamB.noiseStream)

    const debounceMS = 10
    const allCoresAdded = Promise.all([
      new Promise((resolve, reject) => {
        const addedCores = { input: 0, output: 0 }
        let debounceCoreAdded = null
        managerA.on('core-added', (core, destination) => {
          addedCores[destination]++
          if (addedCores.input > 0 && addedCores.output > 0) {
            clearTimeout(debounceCoreAdded)
            debounceCoreAdded = setTimeout(resolve, debounceMS)
          }
        })
      }),
      new Promise((resolve, reject) => {
        const addedCores = { input: 0, output: 0 }
        let debounceCoreAdded = null
        managerB.on('core-added', (core, destination) => {
          addedCores[destination]++
          if (addedCores.input > 0 && addedCores.output > 0) {
            clearTimeout(debounceCoreAdded)
            debounceCoreAdded = setTimeout(resolve, debounceMS)
          }
        })
      })
    ])

    pipeline([
      streamA,
      streamB,
      streamA
    ])

    await allCoresAdded

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

  t.test('manager w/ different ids dont collide', async (t) => {
    const ID1 = 'id1'
    const ID2 = 'id2'

    const [storeA, baseA1] = await create()
    const [storeB, baseB1] = await create()

    const coreA2 = storeA.get({ name: 'my-input2' })
    const coreOutA2 = storeA.get({ name: 'my-output2' })
    const baseA2 = new Autobase({
      inputs: [coreA2],
      localInput: coreA2,
      outputs: [coreOutA2],
      localOutput: coreOutA2,
      autostart: true,
      eagerUpdate: true
    })
    await baseA2.ready()

    const coreB2 = storeB.get({ name: 'my-input2' })
    const coreOutB2 = storeB.get({ name: 'my-output2' })
    const baseB2 = new Autobase({
      inputs: [coreB2],
      localInput: coreB2,
      outputs: [coreOutB2],
      localOutput: coreOutB2,
      autostart: true,
      eagerUpdate: true
    })
    await baseB2.ready()

    const streamA = storeA.replicate(true)
    const streamB = storeB.replicate(false)

    const managerA1 = new AutobaseManager(baseA1, () => true,
      storeA.get.bind(storeA), storeA.storage, { id: ID1 })
    managerA1.attachStream(streamA.noiseStream)
    const managerA2 = new AutobaseManager(baseA2, () => true,
      storeA.get.bind(storeA), storeA.storage, { id: ID2 })
    managerA2.attachStream(streamA.noiseStream)

    const managerB1 = new AutobaseManager(baseB1, () => true,
      storeB.get.bind(storeB), storeB.storage, { id: ID1 })
    managerB1.attachStream(streamB.noiseStream)
    const managerB2 = new AutobaseManager(baseB2, () => true,
      storeB.get.bind(storeB), storeB.storage, { id: ID2 })
    managerB2.attachStream(streamB.noiseStream)

    pipeline([
      streamA,
      streamB,
      streamA
    ])

    await new Promise((resolve) => { setTimeout(resolve, 100) })

    t.deepEqual(baseB1.inputs.map((core) => core.key),
      [baseB1.localInput, baseA1.localInput].map((core) => core.key),
      'baseB1 got baseA1\'s inputs')
    t.deepEqual(baseA2.outputs.map((core) => core.key),
      [baseA2.localOutput, baseB2.localOutput].map((core) => core.key),
      'baseA2 got baseB2\'s outputs')
    t.notDeepEqual(baseA1.inputs.map((core) => core.key),
      baseA2.inputs.map((core) => core.key),
      'baseA1 did not sync baseA2\'s inputs')
    t.notDeepEqual(baseB1.outputs.map((core) => core.key),
      baseB2.outputs.map((core) => core.key),
      'baseB1 did not sync baseB2\'s outputs')
    t.end()
  })

  t.test('manager w/ same ids throws error', async (t) => {
    const ID1 = 'id1'

    const [storeA, baseA1] = await create()

    const coreA2 = storeA.get({ name: 'my-input2' })
    const coreOutA2 = storeA.get({ name: 'my-output2' })
    const baseA2 = new Autobase({
      inputs: [coreA2],
      localInput: coreA2,
      outputs: [coreOutA2],
      localOutput: coreOutA2,
      autostart: true,
      eagerUpdate: true
    })
    await baseA2.ready()

    const streamA = storeA.replicate(true)

    const managerA1 = new AutobaseManager(baseA1, () => true,
      storeA.get.bind(storeA), storeA.storage, { id: ID1 })
    managerA1.attachStream(streamA.noiseStream)
    const managerA2 = new AutobaseManager(baseA2, () => true,
      storeA.get.bind(storeA), storeA.storage, { id: ID1 })
    t.throws(() => managerA2.attachStream(streamA.noiseStream),
      /Attempted to attach to a stream with either duplicate or already closed channel/,
      'throws error about colliding ids')

    t.end()
  })
})
