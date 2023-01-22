import test from 'tape'
import RAM from 'random-access-memory'
import Corestore from 'corestore'
import emitNewCores from '../index.js'

test('full replicate', (t) => {
  t.test('emits message when a core is added', async (t) => {
    t.plan(1)

    const storeA = new Corestore(RAM)
    const storeB = new Corestore(RAM)

    await storeA.ready()
    await storeB.ready()

    let streamA
    const streamAProm = new Promise((resolve, reject) => {
      streamA = emitNewCores(storeA, (key) => {
        t.is(key, expectedKey.toString('hex'))
        resolve()
      }, true)
    })
    const streamB = emitNewCores(storeB, (key) => {
      t.fail('self announced')
    }, false)

    streamA.pipe(streamB).pipe(streamA)

    const core = await storeB.get({ name: 'beep' })
    await core.ready()
    const expectedKey = core.key

    await streamAProm
  })
})
