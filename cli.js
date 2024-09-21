#!/usr/bin/env node

/* eslint import/no-dynamic-require: "off", no-unused-vars: "off", no-console: "off" */

const debug = require('debug')('supr')
const fs = require('fs')
const logger = require('pino')()
const os = require('os')
const path = require('path')
const program = require('commander')

const { createCFS } = require('cfsnet/create')

const cat = require(path.resolve(__dirname, 'lib', 'cat'))
const concat = require(path.resolve(__dirname, 'lib', 'concat'))
const create = require(path.resolve(__dirname, 'lib', 'create'))
const join = require(path.resolve(__dirname, 'lib', 'join'))
const metadata = require(path.resolve(__dirname, 'lib', 'metadata'))
const mp4 = require(path.resolve(__dirname, 'lib', 'mp4'))
const Pool = require(path.resolve(__dirname, 'lib', 'pool'))
const segment = require(path.resolve(__dirname, 'lib', 'segment'))
const send = require(path.resolve(__dirname, 'lib', 'send'))
const util = require(path.resolve(__dirname, 'lib', 'util'))
const write = require(path.resolve(__dirname, 'lib', 'write'))

function checkEnv() {
  debug('gathering local environment information...')
  const localEnv = {
    ffmpeg: process.env.FFMPEG_PATH,
    ffprobe: process.env.FFPROBE_PATH,
    cfs: process.env.CFS_ROOT,
    videos: process.env.VIDEOS_ROOT
  }
  debug(localEnv)
  return localEnv
}

async function prepareOpts(cfs, bitrate=200000, level=5.1) {
  try {
    const staticOpts = await cfs.readFile(`${cfs.HOME}/metadata/source.json`)
    return new Promise((resolve, reject) => {
      const video = JSON.parse(`${staticOpts}`).video[0]
      const argOpts = Object.assign({ bitrate, level },
        {
          width: video.width,
          height: video.height,
          fps: video.r_frame_rate,
          profile: video.profile
        })
      resolve(argOpts)
    })
  } catch (err) {
    throw err
  }
}

async function checkConfig(cfs) {
  try {
    debug('gathering configs from a cfs')
    const configs = await cfs.readdir(`${cfs.HOME}/config`)
    debug(configs)
    return configs
  } catch (err) {
    throw err
  }
}

async function updateConfig(cfs, cfg, val) {
  try {
    const writer = await cfs.createWriteStream(`${cfs.HOME}/config/${cfg}.json`)
    return new Promise((resolve, reject) => {
      writer.on('end', () => resolve)
      writer.on('error', err => reject(err))
      writer.write(JSON.stringify(val))
      writer.end()
    })
  } catch (err) {
    throw err
  }
}

async function parseCmd() {
  const configCfs = await create('suprconfig', program.key)
  debug('configCfs created')
  program
    .description('Command Line for Suprnova')
    .version('0.4.0', '-v, --version')
    .usage('[options] <cmd>')
    .option('-k, --key <key_string>', 'set the CFS key', null)
    .option('-i, --id <id_string>', 'set the CFS identifier', `suprnova/${Math.floor(new Date() / 1000)}`)
    .option('-t, --temp <temp_path>', 'set a non-standard temp path', `${os.tmpdir()}`)
    .option('-y, --yes', 'disable sanity checks, do the bidding of the user without questioning it')

  program
    .command('add <path>')
    .description("Adds the given file or directory's contents to a CFS.")
    .option('-p, --prefix <prefix>', 'Prepend the write path with a prefix')
    .option('-T, --torrent', 'Path is a torrent to be downloaded')
    .action(async (addPath, options) => {
      try {
        const cfs = await create(program.id, program.key)
        const cfsAdd = logger.child({
          id: cfs.identifier.toString('utf8'),
          key: cfs.key.toString('hex'),
          command: 'add',
          add: addPath,
          torrent: options.torrent || false
        })
        if (options.torrent) {
          const tmpPath = await util.getTorrent(addPath)
          const tmpWrites = tmpPath.map(async tmp => write(
            `/tmp/${tmp.path}`,
            cfs,
            options.prefix || ''
          ))
          cfsAdd.info(tmpWrites)
          return console.log()
        }
        const writes = await write(addPath, cfs, options.prefix || '')
        cfsAdd.info(writes)
        return console.log()
      } catch (e) {
        logger.error(e)
        return console.log()
      }
    })

  program
    .command('cat <cfs_path>')
    .description('Pipes a CFS file to STDOUT')
    .action(async (cfsPath) => {
      try {
        const cfs = await create(program.id, program.key)
        return await cat(cfsPath, cfs)
      } catch (e) {
        logger.error(e)
        return console.log()
      }
    })

  program
    .command('concat [segments_dir]')
    .description('Concatenates the segments in a CFS segments dir')
    .option('-m, --mux', 'Also mux the concatenated media to a new MP4')
    .action(async (segsDir, options) => {
      try {
        const cfs = await create(program.id, program.key)
        const dir = segsDir || 'segments/outputs'
        const cfsConcat = logger.child({
          id: cfs.identifier.toString('utf8'),
          key: cfs.key.toString('hex'),
          command: 'concat',
          dir
        })
        const concatFile = await concat(cfs, dir)
        if (!options.mux) {
          cfsConcat.info(concatFile)
          updateConfig(cfs, 'concat', concatFile)
          return console.log()
        }
        const muxFile = await mp4.mux(cfs, concatFile)
        cfsConcat.info(muxFile)
        updateConfig(cfs, 'mux', muxFile)
        return console.log()
      } catch (e) {
        logger.error(e)
        return console.log()
      }
    })

  program
    .command('create [profile_name]')
    .description('Creates a new CFS')
    .action(async (prof) => {
      try {
        const cfs = await createCFS({ id: program.id })
        await cfs.mkdirp(`${cfs.HOME}/config`)
        const cfsCreate = logger.child({
          id: cfs.identifier.toString('utf8'),
          key: cfs.key.toString('hex'),
          command: 'create'
        })
        cfsCreate.info({ success: true })
        process.nextTick(() => cfs.close())
        return console.log()
      } catch (e) {
        logger.error(e)
        return console.log()
      }
    })

  program
    .command('demux <source_file>')
    .description('Demuxes the declared file and writes the tracks to CFS')
    .action(async (mp4File) => {
      try {
        const cfs = await create(program.id, program.key)
        const configs = await checkConfig(cfs)
        const demuxCmd = logger.child({
          id: cfs.identifier.toString('utf8'),
          key: cfs.key.toString('hex'),
          command: 'demux'
        })
        if (configs.indexOf('tracks.json') !== -1 && program.yes !== true) {
          return demuxCmd.error({ err: 'must enable yes mode to overwrite!' })
        }
        const tracks = await mp4.demux(cfs, mp4File, program.temp)
        demuxCmd.info({ tracks })
        updateConfig(cfs, 'tracks', tracks)
        return console.log()
      } catch (e) {
        logger.error(e)
        return console.log()
      }
    })

  program
    .command('events')
    .description('Print the CFS event log')
    .action(async () => {
      try {
        if (!program.id) {
          throw new Error('An ID must be specified. See supr -h for more details.')
        }
        const cfs = await create({ id: program.id })
        return await cat('/var/log/events', cfs)
      } catch (e) {
        logger.error(e)
        return console.log()
      }
    })

  program
    .command('grab <swarm_key>')
    .description('Grab a segment from a joined Suprnova pool')
    .action(async (sk) => {
      try {
        if (!program.key || !sk) {
          throw new Error('A key and a swarm key are both required to grab from this remote Pool.')
        }
        const opts = {
          id: program.id,
          key: program.key,
          temp: program.temp,
          yes: program.yes
        }
        const cfs = await createCFS({
          id: program.id,
          key: Buffer.from(program.key, 'hex'),
          sparseMetadata: false,
          sparse: true
        })
        await join(sk, cfs, opts)
        return console.log()
      } catch (err) {
        logger.error(err)
        return console.log()
      }
    })

  program
    .command('insert <path>')
    .description('Insert an encoded segment into your own local Pool CFS. Be a part of the solution, not the problem.')
    .action(async (p) => {
      try {
        const opts = {
          id: program.id,
          key: program.key,
          temp: program.temp,
          yes: program.yes
        }
        const insertLogger = logger.child({
          toInsert: p,
          opts
        })
        const cfs = await create(program.id, program.key)
        const inserted = await write(p, cfs, 'segments/outputs')
        const pool = new Pool(program.id, program.key)
        await pool.loadConfig()
        const segTestStr = await pool.updateCompletes()
        return console.log()
      } catch (e) {
        logger.error(e)
        return console.log()
      }
    })

  program
    .command('install <path>')
    .description('Install binaries to local temporary application location')
    .action(async (p) => {
      try {
        const installLogger = logger.child({
          installPath: p
        })
        await fs.access(`${p}/ffmpeg-4.1-win64-static`, fs.constants.F_OK, async (err) => {
          if (!err) {
            installLogger.info({
              msg: 'Not installing; already installed',
              success: true
            })
            return console.log()
          }
          await util.getFfmpeg(p)
          installLogger.info({ success: true })
          return console.log()
        })
      } catch (installErr) {
        logger.child.error(installErr)
        return console.log()
      }
    })

  program
    .command('join <swarm_key>')
    .description('Join a Suprnova pool')
    .action(async (sk) => {
      try {
        if (!program.key || !sk) {
          throw new Error('A key and a swarm key are both required to join this remote Pool.')
        }
        const opts = {
          id: program.id,
          key: program.key,
          temp: program.temp,
          yes: program.yes
        }
        const cfs = await createCFS({
          id: program.id,
          key: Buffer.from(program.key, 'hex'),
          sparseMetadata: false,
          sparse: true
        })
        const segmentPath = await join(sk, cfs, opts)
        logger.info(segmentPath)
        return console.log()
      } catch (err) {
        logger.error(err)
        return console.log()
      }
    })

  program
    .command('launch')
    .description('Launch a Suprnova pool')
    .option('-P, --public', 'Invites Littlstar to anonymously join your Pool')
    .option('-B, --bitrate <bits>', 'Specify bitrate [200000]', 200000)
    .option('-L, --level <AVC level>', 'Specify the AVC encoding level [5.1]', 5.1)
    .action(async (options) => {
      try {
        if (program.key) {
          throw new Error('Do not specify a key to launch this CFS')
        }
        const pool = new Pool(program.id, program.key, options)
        await pool.loadConfig()
        const encOpts = await prepareOpts(pool.cfs, options.bitrate, options.level)
        const launchLogger = logger.child({
          id: pool.cfs.identifier.toString('utf8'),
          key: pool.cfs.key.toString('hex'),
          discoveryKey: pool.cfs.discoveryKey.toString('hex'),
          options: {
            public: options.public
          },
          command: 'launch',
          encodeOptions: encOpts
        })
        await pool.launch()
        launchLogger.info({ success: true })
        return console.log()
      } catch (err) {
        logger.error(err)
        return console.log()
      }
    })

  program
    .command('ls [path]')
    .description('List the contents of a CFS')
    .option('-r, --recursive', 'Recurse directories', false)
    .action(async (lsPath, options) => {
      try {
        if (!program.id) {
          return console.error('Missing CFS identifier')
        }
        const cfs = await create(program.id, program.key)

        const listPath = cfs.resolve(lsPath || cfs.HOME)

        const lsLogger = logger.child({
          id: cfs.identifier.toString('utf8'),
          key: cfs.key.toString('hex'),
          prefix: listPath,
          command: 'ls'
        })
        const files = await cfs.readdir(listPath)

        const lsOut = files.map(f => path.resolve(`${listPath}/${f}`))
        lsLogger.info({ files: lsOut })
        return console.log()
      } catch (err) {
        logger.error(err)
        return console.log()
      }
    })

  program
    .command('metadata <media_file>')
    .description('Outputs video metadata to cfs:/home/sources/metadata/')
    .action(async (mediaFile) => {
      try {
        const cfs = await create(program.id, program.key)
        const cfsFileMetadata = logger.child({
          id: cfs.identifier.toString('utf8'),
          key: cfs.key.toString('hex'),
          command: 'metadata',
          file: mediaFile
        })
        const md = await metadata(mediaFile, cfs)
        cfsFileMetadata.info(md.get('cfsPath'))
        return console.log()
      } catch (e) {
        logger.error(e)
        return console.log()
      }
    })

  program
    .command('mux [concat_file]')
    .description('Muxes the declared concat file into an MP4 container')
    .action(async (concatFile) => {
      try {
        const cfs = await create(program.id, program.key)
        const muxCmd = logger.child({
          id: cfs.identifier.toString('utf8'),
          key: cfs.key.toString('hex'),
          command: 'mux'
        })
        await mp4.mux(cfs, concatFile)
        const muxOutFile = `outputs/muxes/${path.basename(concatFile)}.mp4`
        muxCmd.info(muxOutFile)
        updateConfig(cfs, 'mux', muxOutFile)
        return console.log()
      } catch (e) {
        logger.error(e)
        return console.log()
      }
    })

  program
    .command('segment <media_file>')
    .description('Segment a file and write the outputs to CFS')
    .action(async (inputFile) => {
      try {
        const cfs = await create(program.id, program.key)
        const opts = {
          id: program.id,
          key: program.key,
          temp: program.temp,
          yes: program.yes
        }
        const cfsSegment = logger.child({
          id: cfs.identifier.toString('utf8'),
          key: cfs.key.toString('hex'),
          command: 'segment',
          opts
        })
        const configs = await checkConfig(cfs)
        cfsSegment.info(configs)
        await metadata(inputFile, cfs)
        if (configs.indexOf('segments.json') !== -1 && program.yes !== true) {
          return cfsSegment.error({ err: 'must enable yes mode to overwrite!' })
        }
        const [ segments, tmpDir ] = await segment(inputFile, cfs, program.temp)
        const segmentsTmp = segments.map(s => path.join(path.resolve(tmpDir), path.basename(s)))
        cfsSegment.info({ segments, segmentsTmp })
        updateConfig(cfs, 'segments', segments)
        return console.log()
      } catch (e) {
        logger.error(e)
        return console.log()
      }
    })

  program
    .command('send <discovery_key>')
    .description('Send your work CFS to a Suprnova pool')
    .action(async (dk) => {
      try {
        // Create CFS without a key to ensure it is writable
        if (program.key) {
          throw new Error('Work CFS must not specify a key.')
        }
        const opts = {
          id: program.id,
          key: program.key,
          temp: program.temp,
          yes: program.yes
        }
        const cfs = await createCFS({
          id: program.id,
          sparseMetadata: false,
          sparse: true
        })
        await send(dk, cfs, opts)
        return console.log()
      } catch (err) {
        logger.error(err)
        return console.log()
      }
    })

  debug('cli args', {
    id: program.id, key: program.key, temp: program.temp, yes: program.yes
  })

  if (process.argv.length < 3) {
    return program.help()
  }

  debug(process.argv.join(' '))

  return program.parse(process.argv) || program.help()
}

process.on('warning', e => debug(e.stack))
process.on('exit', code => debug(`Exiting with code ${code}`))

void (async function main() {
  try {
    await parseCmd()
  } catch (execError) {
    logger.error(`Failed to execute: ${execError}`)
    console.log()
    process.exit(1)
  }
}())
