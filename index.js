import Protomux from 'protomux'
import c from 'compact-encoding'
import b4a from 'b4a'

export class AutobaseManager {
  constructor (stream, base, allow, get) {
    this.base = base

    const mux = Protomux.from(stream)

    const channel = mux.createChannel({ protocol: 'autobase-manager' })
    channel.open()

    this.inputAnnouncer = channel.addMessage({
      encoding: c.array(c.string),
      async onmessage (msgs, session) {
        const allowedKeys = msgs.filter((msg) => allow(msg, 'input', session))
        if (allowedKeys.length) {
          for (const key of allowedKeys) {
            const core = get(b4a.from(key, 'hex'))
            await core.ready() // seems necessary for autobase id setup

            await base.addInput(core)
          }
        }
      }
    })

    this.outputAnnouncer = channel.addMessage({
      encoding: c.array(c.string),
      async onmessage (msgs, session) {
        const allowedKeys = msgs.filter((msg) => allow(msg, 'output', session))
        if (allowedKeys.length) {
          for (const key of allowedKeys) {
            const core = get(b4a.from(key, 'hex'))

            // Necessary for autobase id (aka the core's id) setup
            await core.ready()

            // Update output to ensure up to date before adding
            // Get a 'Batch is out-of-date.' error otherwise
            if (base.started) {
              await base.view.update()
            }

            await base.addOutput(core)
          }
        }
      }
    })

    if (this.base.localInput || this.base.inputs || this.base.outputs || this.base.localOutput) this.announce()
  }

  announce () {
    const keys = this.base.inputs.map((core) => core.key.toString('hex'))
    if (keys.length) {
      this.inputAnnouncer.send(keys)
    }

    const outputKeys = this.base.outputs.map((core) => core.key.toString('hex'))
    if (outputKeys.length) {
      this.outputAnnouncer.send(outputKeys)
    }
  }
}
