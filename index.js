import Protomux from 'protomux'
import c from 'compact-encoding'

export default function emitNewCores (store, cb, ...args) {
  const replicationStream = store.replicate(...args)

  const mux = Protomux.from(replicationStream.noiseStream)

  const channel = mux.createChannel({ protocol: 'full-send' })
  channel.open()

  const message = channel.addMessage({ encoding: c.string })
  message.onmessage = cb

  store.on('core-open', (core) => {
    message.send(core.key.toString('hex'))
  })

  return replicationStream
}
