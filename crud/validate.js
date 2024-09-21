const { createCFS } = require('cfsnet/create')
const debug = require('debug')('validation')
const ffmpeg = require('fluent-ffmpeg')
const fs = require('fs')
const logger = require('pino')({ name: 'validator' })
const os = require('os')
const path = require('path')
const process = require('process')
const resemble = require('resemblejs')
const compareImages = require("resemblejs/compareImages")

if (os.platform() === 'win32') {
  ffmpeg.setFfprobePath(path.join(process.cwd(), 'ffmpeg/ffmpeg-4.1-win64-static/bin/ffmpeg.exe'))
}


/**
 * validateProbes
 *
 * @param probes
 * @returns {object}
 *
 * Takes in probe information and assesses whether the two images possess
 * the same media properties. Returns an object containing each test as an
 * array: [bool, string, string]
 */

async function validateProbes(probes) {
  if (!probes[0] || !probes[1]) {
    throw Error('Probe data missing')
  }
  function getPixCount(probe) {
    return parseInt(probe.streams[0].width * probe.streams[0].height, 0)
  }
  const results = {
    nb_frames: [
      probes[0].streams[0].nb_frames === probes[1].streams[0].nb_frames,
      probes[0].streams[0].nb_frames,
      probes[1].streams[0].nb_frames,
    ],
    r_frame_rate: [
      probes[0].streams[0].r_frame_rate === probes[1].streams[0].r_frame_rate,
      probes[0].streams[0].r_frame_rate,
      probes[1].streams[0].r_frame_rate
    ],
    duration: [
      probes[0].streams[0].duration === probes[1].streams[0].duration,
      probes[0].streams[0].duration,
      probes[1].streams[0].duration
    ],
    probeScore: [
      probes[0].format.probe_score === probes[1].format.probe_score,
      probes[0].format.probe_score,
      probes[1].format.probe_score
    ],
    pixelsPerFrame: [
      getPixCount(probes[0]) === getPixCount(probes[1]),
      getPixCount(probes[0]),
      getPixCount(probes[1])
    ]
  }
  debug(`Pixel count: ${getPixCount(probes[0])}`)
  return results
}

async function probeMediaFile(mediaStream) {
  try {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(mediaStream, (probeError, data) => {
        if (probeError) { reject(probeError) }
        resolve(data)
      })
    })
  } catch (err) {
    throw err
  }
}

/**
 * extractKeyframe
 *
 * @param segment
 * @param basename
 * @param fileVersion
 * @returns {Promise}
 *
 * Extracts the keyframe from the video segment file
 * Returns a Promise containing the image's temporary output
 * directory, so that it can be further analyzed for validation
 */


async function extractKeyframe(segment, basename, fileVersion) {
  const kfCommand = ffmpeg(segment).inputOptions([
    '-probesize 50000M',
    '-analyzeduration 1000000M'
  ]).videoFilters('thumbnail').outputOptions([
    '-vsync', '0',
    '-frames:v', '1'
  ])
  const cmdOutput = `${os.tmpdir()}/${basename}_${fileVersion}.png`
  return new Promise((resolve, reject) => {
    kfCommand.on('start', cmd => debug({ cmd }))
      .on('codecData', cd => debug(cd))
      .on('error', err => reject(err))
      .on('stderr', stderr => debug(stderr))
      .on('end', () => {
        logger.info('ended')
        resolve(cmdOutput)
      })
      .output(cmdOutput)
      .run()
  })
}

/**
 * main
 *
 * @param sourceSegment
 * @param encodedSegment
 * @param id
 * @param key=null
 * @returns {object}
 */

async function main(sourceSegment, encodedSegment, id, key = null) {
  try {
    const options = {
        output: {
            errorColor: {
                red: 255,
                green: 0,
                blue: 255
            },
            errorType: "diffOnly",
            // transparency: 0.3,
            largeImageThreshold: 0,
            useCrossOrigin: false,
            outputDiff: true
        },
        scaleToSameSize: false,
        ignore: "antialiasing"
    }
    const cfs = await createCFS({ id, key })
    const probes = await Promise.all([
      probeMediaFile(await cfs.createReadStream(sourceSegment)),
      probeMediaFile(await cfs.createReadStream(encodedSegment))
    ])
    debug(probes)

    const sourceKey = await extractKeyframe(
      await cfs.createReadStream(sourceSegment),
      path.basename(sourceSegment, path.extname(sourceSegment)), 'source'
    )

    const encodeKey = await extractKeyframe(
      await cfs.createReadStream(encodedSegment),
      path.basename(encodedSegment, path.extname(encodedSegment)), 'encode'
    )

    const probe = await validateProbes(probes)
    debug(probe)

    const diffPic = await compareImages(
      sourceKey,
      encodeKey,
      options
    )

    fs.writeFileSync('test.png', diffPic.getBuffer())
    return diffPic
  } catch (err) {
    logger.error(err)
    throw err
  }
}

module.exports = main
