const debug = require('debug')('supr:peer')
const { EventEmitter } = require('events')
const fs = require('fs')
const noise = require('noise-network')
const os = require('os')
const path = require('path')
const logger = require('pino')({ name: 'peer' })
const system = require('./system')

class Peer extends EventEmitter {
  constructor(sk, cfs, options) {
    super()
    this.swarmKey = sk
    this.cfs = cfs
    this.options = options
    this.id = this.cfs.identifier
    this.key = this.cfs.key
    this.segments = {
      claimed: [],
      received: [],
      processing: [],
      done: [],
      delivered: []
    }
    this.logger = logger.child({
      id: this.id.toString('utf8'),
      key: this.key.toString('hex'),
      swarmKey: this.swarmKey.toString('hex'),
    })
    debug('Peer class created', this.id, this.key, this.swarmKey, this.options)
  }

  async getSystemInfo() {
    try {
      this.systemInfo = JSON.stringify(await system())
      return this.systemInfo
    } catch (err) {
      throw err
    }
  }

  async joinPool(sk, task) {
    function handle(signal) {
      this.logger.info({ signal })
    }
    try {
      process.on('SIGINT', () => {
        this.logger.info('Received SIGINT. Press Control-D to exit.')
      })
      process.on('SIGINT', handle)
      process.on('SIGTERM', handle)
      this.client = noise.connect(sk)
      this.client.on('handshake', async (...args) => {
        this.logger.info(...args)
        switch (task) {
        case 'work':
          this.client.write(task)
          await this.replicatePool()
          break
        case 'send':
        default:
          this.client.write(`${task}:${this.cfs.key.toString('hex')}`)
          await this.sendWork()
          break
        }
      })
      this.client.on('error', err => this.logger.error(err))
      this.client.on('close', () => {
        this.logger.info('Client closed. Exiting')
        process.exit(0)
      })
    } catch (err) {
      throw err
    }
  }

  async downloadRemoteData(remoteUserData) {
    try {
      const sourcePath = remoteUserData.toString('utf8')
      const downloadPath = `${this.options.temp || os.tmpdir()}/${path.basename(sourcePath)}`
      this.cfs.open(sourcePath, 'r', (err) => {
        if (err) {
          if (err.code === 'ENOENT') {
            this.logger.error('does not exist', sourcePath)
          }
          throw err
        }
        const reader = this.cfs.createReadStream(sourcePath)
        reader.on('error', (readErr) => {
          this.logger.error(readErr)
          throw readErr
        })
        const segmentWriter = fs.createWriteStream(downloadPath)
        segmentWriter.on('error', writeErr => this.logger.error(writeErr))
        segmentWriter.on('finish', () => {
          this.segments.received.push(sourcePath)
          this.logger.info({ received: this.segments.received })
          this.client.end()
          return downloadPath
        })

        this.segments.claimed.push(sourcePath)
        this.logger.info({ claimed: this.segments.claimed })

        this.cfs.download(sourcePath)
        reader.pipe(segmentWriter)
      })
    } catch (err) {
      throw err
    }
  }

  async replicatePool() {
    try {
      const repStream = this.cfs.replicate()
      repStream.on('handshake', async () => {
        const ds = await this.downloadRemoteData(repStream.remoteUserData)
        this.logger.info({ downloadedSegment: ds })
      })
      repStream.on('error', (err) => {
        this.logger.error(err)
        throw err
      })
      repStream.on('end', () => debug('cfs replication stream end'))
      this.client.pipe(repStream).pipe(this.client)
    } catch (err) {
      throw err
    }
  }

  async sendWork() {
    try {
      const segsToDeliver = await this.cfs.readdir('segments/outputs')
      const segMap = segsToDeliver.map(m => `segments/outputs/${m}`)
      const mapStr = segMap.join(':')
      const repStream = this.cfs.replicate({
        userData: Buffer.from(mapStr)
      })
      repStream.on('error', (err) => {
        this.logger.error(err)
        throw err
      })
      repStream.on('end', () => {
        debug('done replicating')
      })
      repStream.pipe(this.client).pipe(repStream)
    } catch (err) {
      throw err
    }
  }
}

module.exports = Peer
