const { EventEmitter } = require('events')
const debug = require('debug')('supr:pool')
const fs = require('fs')
const hash = require('cfsnet/crypto').blake2b
const logger = require('pino')({ name: 'pool' })
const noise = require('noise-network')
const path = require('path')
const si = require('systeminformation')
const cat = require('./cat')
const concat = require('./concat')
const mp4 = require('./mp4')
const { createCFS } = require('cfsnet/create')
const feed = require('./feed')
const util = require('./util')

/* Pool workflow:
 ******************************
 * 1. Pending initialization.
 * 2. Created.
 * 3. Source validated.
 * 4. Source demuxed.
 * 5. Source segmented.
 * 6. Segments awaiting encode.
 * 7. Segments encoding.
 * 8. All segments encoded.
 * 9. Segments concatenated by host.
 * 10. Concatenated video is muxed.
 * ****************************
*/

class Pool extends EventEmitter {
  constructor(id, key, opts) {
    super()
    this.id = id
    this.key = key
    this.opts = opts
    this.creationDate = util.epoch()
    this.tracks = []
    this.segments = []
    this.segmentsAvailable = []
    this.segmentsClaimed = []
    this.segmentsActive = []
    this.segmentsComplete = []
    this.sockets = {}
    this.uptime = process.uptime()
    this.startCount = 0
    this.logger = logger.child({
        creationDate: this.creationDate,
        uptime: this.uptime
    })
    debug('new pool')
    // this.buildMetadata()
  }

  async buildMetadata() {
    try {
      this.si = await si.users()
      this.user = this.si[0].user
      this.metadata = {
        title: `${this.id}`,
        description: 'A Suprnova RSS feed',
        id: '',
        author: this.user,
        link: '',
        updated: new Date()
      }
    } catch (err) {
      this.logger.error(err)
      throw err
    }
  }

  async createPoolCFS() {
    try {
      this.cfs = await createCFS({ id: this.id })
      debug('pool CFS created')
      return this.cfs
    } catch (err) {
      throw err
    }
  }

  async eventLog() {
    return cat('/var/log/events', this.cfs)
  }

  async generateFeed() {
    try {
      this.feed = await feed(this)
      return this.feed
    } catch (err) {
      throw err
    }
  }

  async loadConfig() {
    try {
      await this.createPoolCFS()
      const cfgs = await this.cfs.readdir(`${this.cfs.HOME}/config`)
      const configData = await Promise.all(cfgs.map(c => this.cfs.readFile(`${this.cfs.HOME}/config/${c}`)))
      this.tracks = (JSON.parse(`${configData[0]}`))
      this.segments = JSON.parse(`${configData[1]}`)
      this.segmentsAvailable = this.segments
      this.ready = this.segments.length > 0
      return this.logger.info({
        tracks: this.tracks,
        segmentsAvailable: this.segmentsAvailable,
        ready: this.ready,
        /*
        options: {
          public: this.opts.public || false
        } */
      })
    } catch (err) {
      throw err
    }
  }

  async updateCompletes() {
    function joinSegMap(s) {
      return path.basename(s)
    }
    try {
      const outSegs = await this.cfs.readdir('segments/outputs')
      this.segmentsComplete.push(...outSegs.map(bn => `${this.cfs.HOME}/segments/outputs/${bn}`))
      debug('Segment added to completion array', this.segmentsComplete)

      const compSort = this.segmentsComplete.sort()
      const segSort = this.segments.sort()

      const compStr = compSort.map(joinSegMap).join('|')
      const segStr = segSort.map(joinSegMap).join('|')

      debug('Segment inputs:', segStr)
      debug('Segments completed:', compStr)

      if (compStr === segStr) {
        this.logger.info('All work is complete. We will now concatenate and mux.')
        const muxFile = await this.finalizeEncode()
        debug(muxFile)
        process.exit(0)
      }

      return [compStr, segStr]
    } catch (insertErr) {
      throw insertErr
    }
  }

  async assignSegmentToPeer() {
    try {
      if (this.segmentsAvailable.length < 1) {
        this.logger.error('Segment not available')
        return false
      }
      const assignedSegment = this.segmentsAvailable.pop()
      this.logger.info({ assignedSegment })
      this.segmentsClaimed.push(assignedSegment)
      return assignedSegment
    } catch (err) {
      throw err
    }
  }

  async downloadRemoteWork(remoteUserData, peerCFS) {
    try {
      const sources = remoteUserData.toString('utf8')
      debug(sources)
      const theSegments = sources.split(':')
      debug(theSegments)
      const sourcePath = theSegments[0].toString('utf8')
      const writer = this.cfs.createWriteStream(sourcePath)
      // const writer = this.cfs.createWriteStream(`segments/outputs/${path.basename(sourcePath)}`)
      return new Promise((resolve, reject) => {
        const peerReader = peerCFS.createReadStream(sourcePath)
        peerReader.on('error', (err) => {
          this.logger.error(err)
          throw err
        })
        writer.on('finish', () => {
          this.logger.info(`Downloaded output segment from peer: ${path.basename(sourcePath)}`)
          process.nextTick(() => resolve(path.basename(sourcePath)))
        })
        writer.on('error', err => reject(err))
        peerCFS.download(sourcePath)
        peerReader.pipe(writer)
      })
    } catch (err) {
      throw err
    }
  }

  async launch() {
    try {
      this.server = noise.createServer()
      this.startCount++
      this.server.on('connection', async (encryptedStream) => {
        function handle(signal) {
          this.logger.info({ signal })
        }

        process.on('SIGINT', () => {
          this.logger.info('Received SIGINT. Press Control-D to exit.')
        })
        process.on('SIGINT', handle)
        process.on('SIGTERM', handle)
        function onerr(err) {
          this.logger.info(err)
        }
        function clientErr(err) {
          this.logger.info('Client error occurred', { err })
        }
        function ontimeout() {
          this.logger.error('Timeout occurred!')
          if (this.startCount > 10) {
            this.logger.error('Server has restarted more than 9 times, quitting!')
            throw Error('10 start counts')
          }
          this.server = noise.createServer()
          this.startCount++
          this.logger.error('Restarted the server')
        }

        encryptedStream.on('timeout', (ontimeout))
        encryptedStream.on('error', (onerr))
        encryptedStream.on('clientError', (clientErr))
        encryptedStream.on('close', () => {
          this.logger.info('closed encrypted stream')
        })
        encryptedStream.on('data', async (d) => {
          if (d.toString('utf8').includes('work')) {
            const assignedSegment = await this.assignSegmentToPeer()

            this.cfs.access(`${assignedSegment}`, fs.constants.F_OK, (err) => {
              debug(`folder ${err ? 'does not exist' : 'exists'}`);
            });

            const repStream = this.cfs.replicate({
              userData: Buffer.from(assignedSegment)
            })
            repStream.pipe(encryptedStream).pipe(repStream)
            this.logger.info('Assigned segment to peer')
          } else if (d.toString('utf8').includes('send')) {
            const encodedSegment = await this.replicatePeer(d.toString('utf8').split(':')[1], encryptedStream)
          }
        })
      })
      const keyPair = noise.seedKeygen(hash(this.cfs.partitions.home.metadata.secretKey ||
        fs.readFileSync(`${this.cfs.partitions.home.storage}/metadata/secret_key`)))
      this.server.listen(keyPair, () => {
        this.logger.info({
          publicKey: this.cfs.key.toString('hex'),
          swarmKey: this.server.publicKey.toString('hex')
        })
      })
    } catch (err) {
      throw err
    }
  }

  async replicatePeer(peerKey, stream) {
    try {
      const peerCFS = await createCFS({
        id: `peer-${Date.now()}`,
        key: peerKey,
        sparseMetadata: false,
        sparse: true
      })
      const repStream = peerCFS.replicate()
      repStream.on('handshake', async () => {
        try {
          const dw = await this.downloadRemoteWork(repStream.remoteUserData, peerCFS)
          this.logger.info({ downloadedWork: dw })
          stream.end()
          // Pop the array of segs being "worked on"
          // `if` statement to see if any other segs are left
          // If not, run finalizeEncode() and finish up.
          this.segmentsComplete.push(dw)
          if (this.segmentsComplete.sort().join('|') === this.segments.sort().join('|')) {
            this.logger.info('All work is complete. We will now concatenate and mux.')
            const muxFile = await this.finalizeEncode()
            debug(muxFile)
            process.exit(0)
          } else {
            debug(`Completed work on ${dw} but the following segments remain: ${this.segmentsAvailable}`)
          }
          return dw
        } catch (err) {
          throw err.stack || err
        }
      })
      repStream.on('error', (err) => {
        this.logger.error(err)
        throw err
      })
      repStream.on('end', () => {
        this.logger.info('CFS replication stream end')
      })
      stream.pipe(repStream).pipe(stream)
    } catch (err) {
      throw err
    }
  }

  async finalizeEncode() {
    try {
      const concatFile = await concat(this.cfs, 'segments/outputs')
      const muxFile = await mp4.mux(this.cfs, concatFile)
      if (!this.concatFile || !this.muxFile) {
        throw Error(`A file is missing! Concat: ${concatFile} -- Mux: ${muxFile}`)
      }
      return muxFile.output
    } catch (err) {
      throw err
    }
  }
}

module.exports = Pool

