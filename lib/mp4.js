const debug = require('debug')('supr:mp4')
const ffmpeg = require('fluent-ffmpeg')
const ffmpegOnProgress = require('ffmpeg-on-progress')
const fs = require('fs')
const logger = require('pino')({ name: 'progress' })
const os = require('os')
const path = require('path')

const metadata = require(path.resolve(__dirname, 'metadata'))
const util = require(path.resolve(__dirname, 'util'))
const write = require(path.resolve(__dirname, 'write'))

if (os.platform() === 'win32') {
  debug('windows detected; setting FFmpeg path to bundled executable')
  ffmpeg.setFfmpegPath(path.join(process.cwd(), 'ffmpeg/ffmpeg-4.1-win64-static/bin/ffmpeg.exe'))
}

function logProgress(progress, event) {
  logger.info({
    progress: (progress * 100).toFixed(),
    timemark: event.timemark
  })
}

async function getMetadataByTrackId(cfs, st) {
  /* Parse the source.json metadata for demuxed track properties */
  try {
    const id = parseInt(path.basename(st).split('_')[1], 10)
    const trackData = {
      base: path.basename(st),
      metadata: JSON.parse(await cfs.readFile('/home/metadata/source.json')).tracks.filter(t => t.index === id)[0],
      reader: cfs.createReadStream(`tracks/inputs/${st}`),
      id
    }
    return trackData
  } catch (e) { throw e }
}

async function pullStems(cfs, stems, temp) {
  /* Pull demuxed source tracks from CFS to a tempdir */
  try {
    const folder = fs.mkdtempSync(`${temp || os.tmpdir()}${path.sep}stems-`)
    const stemStreams = await Promise.all(
      stems.map(st => getMetadataByTrackId(cfs, st))
    )
    debug('got track metadata', stemStreams)
    return new Promise((resolve, reject) => {
      const stemPaths = []
      stemStreams.forEach((stream) => {
        const writer = fs.createWriteStream(`${folder}/${stream.base}`)
        writer.on('error', writeErr => reject(writeErr))
        writer.on('finish', () => {
          stemPaths.push(`${folder}/${stream.base}`)
        })
        stream.reader.on('end', () => {
          writer.end()
        })
        stream.reader.pipe(writer)
      })
      debug('pulled stems to dir:', folder)
      resolve([ stemStreams, folder ])
    })
  } catch (e) { throw e }
}

async function demux(cfs, mp4File, temp = null) {
  try {
    const { format, video, tracks } = JSON.parse(await cfs.readFile('/home/metadata/source.json'))
    if (tracks.length === 0) {
      debug('no non-video tracks in MP4 file - demuxing is unnecessary')
      return false
    }
    const durationEstimate = parseInt(format.duration * 1000, 10)
    debug('duration estimate', durationEstimate)
    const ext = path.extname(mp4File).split('.')[1]
    const ffmpegStream = cfs.createWriteStream('log/ffmpeg_demux.log', { flags: 'a' })
    debug('opened log for FFmpeg stderr streaming')
    const folder = fs.mkdtempSync(`${temp || os.tmpdir()}${path.sep}tracks-`)
    debug('created new write dir for FFmpeg: ', folder)
    return new Promise((resolve, reject) => {
      const outDefaults = [
        /* ensure FFmpeg writes a compliant MP4/QuickTime file */
        '-f', ext,
        /* place mov atom metadata at start of file */
        '-movflags', '+faststart',
        /* Do not write timecode metadata */
        '-write_tmcd', '0'
      ]
      const ffmpegCmd = []
      const cmd = ffmpeg(mp4File).inputFPS(video[0].r_frame_rate)
      let audio = 0
      let sub = 0
      let vid = 1
      tracks.forEach((t) => {
        /* Create FFmpeg map to isolate the single media track */
        cmd.output(path.normalize(`${folder}/track_${t.index}_${t.codec_type}.${ext}`))
        if (t.codec_type === 'audio') {
          cmd.outputOptions([ '-map', `0:a:${audio}`, `-c:a:${audio}`, 'copy', ...outDefaults ])
          audio += 1
        } else if (t.codec_type === 'subtitle') {
          cmd.outputOptions([ '-map', `0:s:${sub}`, `-c:s:${sub}`, 'copy', ...outDefaults ])
          sub += 1
        } else if (t.codec_type === 'video') {
          /* There are non-h264 video codecs that are MPEG4-compliant (mjpeg) */
          cmd.outputOptions([ '-map', `0:v:${vid}`, `-c:v:${vid}`, 'copy', '-f', ext ])
          vid += 1
        }
      })
      cmd
        .on('start', ffCmd => ffmpegCmd.push(...ffCmd.split(' ')))
        .on('progress', ffmpegOnProgress(logProgress, durationEstimate))
        .on('error', err => reject(Error(`${err} ${ffmpegCmd}`)))
        .on('stderr', (stderr) => {
          debug(stderr)
          /* Log FFmpeg stderr output to CFS */
          ffmpegStream.write(stderr)
          ffmpegStream.write('\n')
        })
        .on('end', async () => {
          ffmpegStream.end()
          const writeOp = await write(folder, cfs, 'tracks/inputs')
          resolve(writeOp)
        })
      cmd.run()
    })
  } catch (e) {
    throw e
  }
}

async function getNewestConcat(cfs) {
  /* Search CFS for the most recent concat file */
  try {
    const concatsDir = await cfs.readdir(`${cfs.HOME}/outputs/concats`)
    if (concatsDir.length === 1) { return concatsDir[0] }
    const epochs = concatsDir.map(s => parseInt(path.basename(s, '.264').split('concat_')[1], 10))
    const sorted = epochs.sort((a, b) => b - a).map(sort => `concat_${sort}.264`)
    return sorted[0]
  } catch (err) { throw err }
}

async function mux(cfs, concat = null, temp = null) {
  try {
    const { video, format } = JSON.parse(await cfs.readFile('/home/metadata/source.json'))
    const durationEstimate = parseInt(format.duration * 1000, 10)
    const ext = (path.extname(format.filename) === '.mov' ? 'mov' : 'mp4')
    const muxSource = concat || `${cfs.HOME}/outputs/concats/${await getNewestConcat(cfs)}`
    const muxOut = path.normalize(`${temp || os.tmpdir()}/${path.basename(muxSource)}.${ext}`)
    const concatStream = cfs.createReadStream(muxSource, { autoclose: true })
    const ffmpegStream = cfs.createWriteStream('log/ffmpeg_mux.log', { flags: 'a' })
    const otherTracks = await util.getTracks(cfs)
    const [ stems, tempDir ] = await pullStems(cfs, otherTracks, temp)
    const ffmpegCmd = []
    return new Promise((resolve, reject) => {
      const cmd = ffmpeg(concatStream).inputFPS(video[0].r_frame_rate)
      stems.forEach(s => cmd.input(`${tempDir}/${s.base}`))
      cmd.outputOptions([
        '-map', '0:0',
        ...stems.map(m => `-map ${m.id}:0`),
        '-c', 'copy',
        '-f', ext,
        '-movflags', '+faststart'
      ]).output(muxOut)
        .on('start', ffCmd => ffmpegCmd.push(...ffCmd.split(' ')))
        .on('progress', ffmpegOnProgress(logProgress, durationEstimate))
        .on('error', err => reject(Error(`${err} ${ffmpegCmd}`)))
        .on('stderr', (stderr) => {
          ffmpegStream.write(stderr)
          ffmpegStream.write('\n')
        })
        .on('end', async () => {
          ffmpegStream.end()
          const [ muxMd, writeOp ] = await Promise.all([
            metadata(muxOut, cfs, `${cfs.HOME}/metadata/${path.basename(muxOut)}.json`),
            write(muxOut, cfs, 'outputs/muxes')
          ])
          resolve({ output: writeOp, metadata: muxMd })
        })
        .run()
    })
  } catch (e) {
    throw e
  }
}

module.exports = { demux, mux }
