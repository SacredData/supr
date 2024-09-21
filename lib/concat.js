/* eslint import/no-dynamic-require: "off", function-paren-newline: "off" */

const debug = require('debug')('supr:concat')
const path = require('path')
const MultiStream = require('multistream')

const util = require(path.resolve(__dirname, 'util'))

async function main(cfs, dir) {
  try {
    const segments = await cfs.readdir(dir)
    const h264 = segments.filter(h => path.extname(h) === '.264')
      .map(hp => `${cfs.HOME}/${dir}/${hp}`)

    debug('segments', h264)
    if (!h264 || !h264.length) {
      return Promise.reject(new Error('No h264 files found'))
    }

    const outFile = `outputs/concats/concat_${util.epoch()}.264`
    debug('concat outfile', outFile)
    const videoBuffers = await Promise.all(
      h264.map(p => cfs.createReadStream(p))
    )
    const writer = cfs.createWriteStream(outFile, { flags: 'a' })

    return new Promise((resolve, reject) => {
      const ms = new MultiStream(videoBuffers)
      ms.on('error', err => reject(err))
      ms.on('end', () => resolve(outFile))
      ms.pipe(writer)
    })
  } catch (e) {
    throw Error(e)
  }
}

module.exports = main
