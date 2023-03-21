# Autobase Manager

A simple "replicate everything" module to synchronizing `autobase`s' `inputs`
and `outputs` via a frame stream (most likely `hyperswarm`).

## Usage

```js
const AutobaseManager = require('@lejeunerenard/autobase-manager')
// ... require other modules

// Create an Autobase
const base = new Autobase({ ... })

const manager = new AutobaseManager(
  base,
  // function to filter core keys
  (key, coreType, channel) => true,
  // get(key) function to get a hypercore given a key
  corestore.get.bind(corestore),
  // Storage for managing autobase keys
  corestore.storage,
  // Options
  { id: 'unique-id-per-autobase' })

// Wait until everything is loaded
await manager.ready()

const swarm = new Hyperswarm()
swarm.on('connection', (conn) => {
  const stream = corestore.replicate(conn)

  // Attach manager
  manager.attachStream(stream)
})
```

## API

`const manager = new Autobase(base, allow, get, storage, opts = {})`

Create a new manager given an autobase, allow function, a means of getting a
core and a storage for persisting keys distributed to load on start.

- `base` : an Autobase to be managed
- `allow` : a function which returns a boolean for whether to add a core or not.
  The function is passed the following arguments: `allow(key, coreType, 
  channel)`:
  - `key` : the key as a hexadecimal string of a core announced by a peer to be
  replicated
  - `coreType` : either `input` or `output` representing whether the core is to
  be added as an input or output on the Autobase.
  - `channel` : the underlying `Protomux` channel in case more advanced logic
  is needed.
- `get(key)` : a function for retrieving a Hypercore when given a key.
- `storage` : a directory where you want to store managed keys or alternatively
  you own
  [random-access-storage](https://github.com/random-access-storage/random-access-storage)
  instance. For example, if using a Corestore, `corestore.storage`.
- `opts`  
  Options include:

  ```
  {
    id: Buffer.from('unique-id-per-autobase') // A unique id per set of autobases. If passed a string, it will be automatically converted into a buffer.
  }
  ```

`await manager.ready()`

Returns a promise that resolves when the manager has loaded all known cores from
storage.

`manager.attachStream(stream)`

Attach manager onto a framed stream to be extended and used for coordinating
Hypercore keys. Most likely you will attach to every connection with a peer.

All known and `allow`ed keys will be announced to the attached stream upon
attaching and as cores are added via peers.

`await manager.announceAll()`

Manually announce to all streams the manager has been attached to. Helpful for
sharing cores that were added to the Autobase not by the manager.

`await manager.updateStorageKeys()`

Update storage keys to be persisted and announce all known keys to all attached
streams.
