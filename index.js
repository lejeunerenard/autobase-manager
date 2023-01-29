import Protomux from 'protomux'
import c from 'compact-encoding'
import b4a from 'b4a'
import Hypercore from 'hypercore'
import { difference } from './utils/set-operations.js'

export class AutobaseManager {
  constructor (base, allow, get, storage) {
    this.base = base
    this.allow = allow
    this.get = get
    this.storage = Hypercore.defaultStorage(storage)

    this._inputKeys = new Set()
    this._outputKeys = new Set()
    this._streams = []

    if (this.base.localInput) {
      this._addKeys([this.base.localInput.key.toString('hex')], 'input')
    }
    if (this.base.localOutput) {
      this._addKeys([this.base.localOutput.key.toString('hex')], 'output')
    }

    // Load storage
    this._ready = this.readStorageKeys()
  }

  ready () {
    return this._ready
  }

  attachStream (stream) {
    const self = this

    const mux = Protomux.from(stream)

    const channel = mux.createChannel({ protocol: 'autobase-manager' })
    channel.open()

    const inputAnnouncer = channel.addMessage({
      encoding: c.array(c.string),
      async onmessage (msgs, session) {
        const allowedKeys = msgs.filter((msg) => self.allow(msg, 'input', session))
        if (allowedKeys.length) {
          // Check if any are new
          const newKeys = difference(allowedKeys, self._inputKeys)
          if (newKeys.size > 0) {
            await self._addKeys(newKeys, 'input')
            await self.updateStorageKeys()
          }
        }
      }
    })

    const outputAnnouncer = channel.addMessage({
      encoding: c.array(c.string),
      async onmessage (msgs, session) {
        const allowedKeys = msgs.filter((msg) => self.allow(msg, 'output', session))
        if (allowedKeys.length) {
          // Check if any are new
          const newKeys = difference(allowedKeys, self._outputKeys)
          if (newKeys.size > 0) {
            await self._addKeys(newKeys, 'output')
            await self.updateStorageKeys()
          }
        }
      }
    })

    const streamRecord = { stream, inputAnnouncer, outputAnnouncer }
    this._streams.push(streamRecord)
    stream.once('close', () => {
      this._streams.slice(this._streams.indexOf(streamRecord), 1)
    })

    if (this.base.localInput || this.base.inputs || this.base.outputs || this.base.localOutput) this.announce(streamRecord)
  }

  async announce (stream) {
    await this.ready()

    const keys = this.base.inputs.map((core) => core.key.toString('hex'))
    if (keys.length) {
      // console.log('[' + this.base.localOutput.key.toString('hex').slice(-6) +
      //       '] announce keys', keys.map((key) => key.slice(-6)))
      stream.inputAnnouncer.send(keys)
    }

    const outputKeys = this.base.outputs.map((core) => core.key.toString('hex'))
    if (outputKeys.length) {
      // console.log('[' + this.base.localOutput.key.toString('hex').slice(-6) +
      //       '] announce outputKeys', outputKeys.map((key) => key.slice(-6)))
      stream.outputAnnouncer.send(outputKeys)
    }
  }

  async announceAll () {
    for (const stream of this._streams) {
      await this.announce(stream)
    }
  }

  async _addKeys (keys, destination) {
    // Get & Ready Cores
    const cores = await Promise.all(Array.from(keys).map(async (key) => {
      const core = this.get(b4a.from(key, 'hex'))
      // Necessary for autobase id (aka the core's id) setup
      await core.ready()
      return core
    }))

    // Add to the corresponding place in autobase
    for (const core of cores) {
      if (destination === 'output') {
        this._outputKeys.add(core.key.toString('hex'))

        // Update output to ensure up to date before adding
        // Get a 'Batch is out-of-date.' error otherwise
        if (this.base.started) await this.base.view.update()

        await this.base.addOutput(core)
      } else {
        this._inputKeys.add(core.key.toString('hex'))
        await this.base.addInput(core)
      }
    }
  }

  _getStorage (file) {
    const MANAGER_DIR = 'autobase-manager/'
    return this.storage(MANAGER_DIR + file)
  }

  readStorageKeys () {
    return Promise.all([
      this._readStorageKey('inputs', this._inputKeys),
      this._readStorageKey('outputs', this._outputKeys)
    ])
  }

  _readStorageKey (file, output) {
    const store = this._getStorage(file)
    return new Promise((resolve, reject) => {
      store.stat(async (err, stat) => {
        if (err) return

        const len = stat.size
        for (let start = 0; start < len; start += 32) {
          await new Promise((resolve2, reject) => {
            store.read(start, 32, function (err, buf) {
              if (err) throw err

              output.add(buf.toString('hex'))
              resolve2()
            })
          })
        }

        store.close()
        resolve()
      })
    }
    )
  }

  async updateStorageKeys () {
    await this._updateStorageKey('inputs', this._inputKeys)
    await this._updateStorageKey('outputs', this._outputKeys)
    await this.announceAll()
  }

  async _updateStorageKey (file, input) {
    const store = this._getStorage(file)
    let i = 0
    for (const data of input) {
      const start = i * 32
      // console.log('write data', data)
      await new Promise((resolve, reject) => {
        store.write(start, b4a.from(data, 'hex'), (err) => {
          if (err) return reject(err)

          resolve()
        })
      })
      i++
    }
    store.close()
  }
}
