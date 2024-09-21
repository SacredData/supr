const debug = require('debug')('supr:vmaf')
const ffmpeg = require('fluent-ffmpeg')

function checkForVmaf() {
  ffmpeg.getAvailableFilters((err, filters) => {
    if (err) { throw err }
    const libvmaf = Object.keys(filters).includes('libvmaf')
    return { libvmaf }
  })
}

async function runVmaf(src, enc) {
  ffmpeg(src).input(enc)
    .outputOptions([
      '-lavfi libvmaf=ms_ssim=1:log_fmt=json',
      '-f null'
    ])
    .output('/dev/null')
    .on('stderr', (stderr) => {
      if (`${stderr}`.includes('VMAF score:')) {
        const vmafScore = `${stderr}`.split(': ')[1]
        debug(`VMAF Score: ----- ${vmafScore}`)
      }
    })
    .run()
}

module.exports = { runVmaf, checkForVmaf }
