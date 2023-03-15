import Protomux from 'protomux'
import c from 'compact-encoding'
import b4a from 'b4a'
import Hypercore from 'hypercore'
import { difference } from './utils/set-operations.js'
import { EventEmitter } from 'events'

const DEBUG = false

export class AutobaseManager extends EventEmitter {
  constructor (base, allow, get, storage, opts = {}) {
    super()
    this.base = base
    this.allow = allow
    this.get = get
    this.storage = Hypercore.defaultStorage(storage)
    this.id = opts.id || b4a.from('main')
    // Ensure id is a buffer for protomux
    if (typeof this.id === 'string') {
      this.id = b4a.from(this.id)
    }

    this._inputKeys = new Set()
    this._outputKeys = new Set()
    this._streams = []

    // Load storage
    this._ready = Promise.resolve().then(() => {
      const coresToLoad = []

      // Load local cores first
      if (this.base.localInput) {
        coresToLoad.push(this._addKeys([b4a.toString(this.base.localInput.key, 'hex')], 'input'))
      }
      if (this.base.localOutput) {
        coresToLoad.push(this._addKeys([b4a.toString(this.base.localOutput.key, 'hex')], 'output'))
      }

      // Load storage cores
      coresToLoad.push(this.readStorageKeys())

      return Promise.all(coresToLoad)
    })
      .then(() => Promise.all([
        this._addKeys(this._inputKeys, 'input'),
        this._addKeys(this._outputKeys, 'output')
      ]))
  }

  ready () {
    return this._ready
  }

  attachStream (stream) {
    const self = this

    const mux = Protomux.from(stream)

    const channel = mux.createChannel({
      protocol: 'autobase-manager',
      id: this.id
    })
    if (channel === null) {
      throw Error('Attempted to attach to a stream with either duplicate or already closed channel. Maybe select a different `id`?')
    }
    channel.open()

    const inputAnnouncer = channel.addMessage({
      encoding: c.array(c.string),
      async onmessage (msgs, session) {
        const allowedKeys = msgs.filter((msg) => self.allow(msg, 'input', session))
        if (allowedKeys.length) {
          DEBUG && console.log('[' +
            b4a.toString(self.base.localOutput.key, 'hex').slice(-6) +
            '] inputs allowedKeys ', allowedKeys.map((key) => key.slice(-6)))

          // Check if any are new
          const newKeys = difference(allowedKeys, self._inputKeys)
          if (newKeys.size > 0) {
            DEBUG && console.log('[' +
              b4a.toString(self.base.localOutput.key, 'hex').slice(-6) +
              '] new inputs', [...newKeys].map((key) => key.slice(-6)))

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
          DEBUG && console.log('[' +
            b4a.toString(self.base.localOutput.key, 'hex').slice(-6) +
            '] outputs allowedKeys ', allowedKeys.map((key) => key.slice(-6)))
          // Check if any are new
          const newKeys = difference(allowedKeys, self._outputKeys)
          if (newKeys.size > 0) {
            DEBUG && console.log('[' +
              b4a.toString(self.base.localOutput.key, 'hex').slice(-6) +
              '] new outputs ', [...newKeys].map((key) => key.slice(-6)))
            await self._addKeys(newKeys, 'output')
            await self.updateStorageKeys()
          }
        }
      }
    })

    const streamRecord = { stream, inputAnnouncer, outputAnnouncer }
    this._streams.push(streamRecord)
    stream.once('close', () => {
      this._streams.splice(this._streams.indexOf(streamRecord), 1)
    })

    if (this.base.localInput || this.base.inputs || this.base.outputs || this.base.localOutput) this.announce(streamRecord)
  }

  async announce (stream) {
    await this.ready()

    const keys = this.base.inputs.map((core) => b4a.toString(core.key, 'hex'))
    if (keys.length) {
      DEBUG && console.log('[' +
        b4a.toString(this.base.localOutput.key, 'hex').slice(-6) +
        '] announce keys', keys.map((key) => key.slice(-6)))
      stream.inputAnnouncer.send(keys)
    }

    const outputKeys = this.base.outputs.map((core) => b4a.toString(core.key, 'hex'))
    if (outputKeys.length) {
      DEBUG && console.log('[' +
        b4a.toString(this.base.localOutput.key, 'hex').slice(-6) +
        '] announce outputKeys', outputKeys.map((key) => key.slice(-6)))
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
        this._outputKeys.add(b4a.toString(core.key, 'hex'))

        // Skip local output lest we get a 'Batch is out-of-date' error
        if (this.base.localOutput && this.base.localOutput.key === core.key) {
          DEBUG && console.log('found local output, continuing')
          continue
        }

        // Update output to ensure up to date before adding
        // Get a 'Batch is out-of-date.' error otherwise
        if (this.base.started) await this.base.view.update()

        await this.base.addOutput(core)
      } else {
        this._inputKeys.add(b4a.toString(core.key, 'hex'))
        await this.base.addInput(core)
      }
      this.emit('core-added', core, destination)
    }
  }

  _getStorage (file) {
    const MANAGER_DIR = ['autobase-manager', this.id.toString()].join('/')
    return this.storage(MANAGER_DIR + '/' + file)
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
        if (err) {
          resolve()
          return
        }

        const len = stat.size
        for (let start = 0; start < len; start += 32) {
          await new Promise((resolve, reject) => {
            store.read(start, 32, function (err, buf) {
              if (err) throw err

              output.add(buf.toString('hex'))
              resolve()
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
