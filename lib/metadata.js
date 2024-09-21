const debug = require('debug')('supr:metadata')
const ffmpeg = require('fluent-ffmpeg')
const path = require('path')
const process = require('process')
const os = require('os')

if (os.platform() === 'win32') {
  debug('windows platform detected')
  const winPathFfmpeg = path.join(process.cwd(), 'ffmpeg/ffmpeg-4.1-win64-static/bin/ffmpeg.exe')
  const winPathFfprobe = path.join(process.cwd(), 'ffmpeg/ffmpeg-4.1-win64-static/bin/ffprobe.exe')
  ffmpeg.setFfmpegPath(winPathFfmpeg)
  ffmpeg.setFfprobePath(winPathFfprobe)
  debug('set FFmpeg path: ', winPathFfmpeg)
  debug('set FFprobe path: ', winPathFfprobe)
}

function validate(md) {
  return new Promise((resolve, reject) => {
    if (!md.video || !md.tracks || !md.format) {
      debug('rejecting video due to bad metadata')
      reject(Error('Missing critical metadata!'))
    } else if (md.format.duration < 120) {
      debug('rejecting video due to a duration under 2 minutes')
      reject(Error('Video is too short! Cannot segment it'))
    } else if (path.extname(md.format.filename) === '.mkv') {
      debug('Rejecting for mkv')
      reject(Error('Matroska is not supported. Please convert to MP4/MOV'))
    }
    debug('video is valid')
    resolve({
      format: md.format.format_name.includes('mp4') || md.format.format_name.includes('mov'),
      video: md.video[0].codec_name === 'h264'
    })
  })
}

function probe(file) {
  return new Promise((resolve, reject) => {
    debug('executing ffprobe on a file: ', file)
    ffmpeg(path.resolve(file)).ffprobe((err, md) => {
      if (err) { reject(err) }
      try {
        const video = md.streams.filter(s => s.codec_type === 'video' && s.codec_name === 'h264')
        const tracks = md.streams.filter(s => s.codec_type !== 'data' && s.codec_name !== 'h264')
        resolve({ format: md.format, video, tracks })
      } catch (e) { reject(Error(e)) }
    })
  })
}

async function main(file, cfs, writePath = '/home/metadata/source.json') {
  try {
    const probeData = await probe(file)

    const mdMap = new Map()
    mdMap.set('metadata', probeData)

    const validation = await validate(probeData)
    mdMap.set('valid', validation)

    mdMap.set('cfsPath', writePath)

    const writeData = JSON.stringify(mdMap.get('metadata'), null, 2)
    debug(writeData)

    const writer = await cfs.createWriteStream(writePath, { flags: 'w' })

    return new Promise((resolve, reject) => {
      writer.on('error', err => reject(err))
      writer.on('end', () => resolve(mdMap))
      writer.write(writeData)
      writer.end()
    })
  } catch (e) {
    throw e
  }
}

module.exports = main
