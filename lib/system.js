const si = require('systeminformation')

async function getSystemInfo() {
  try {
    return Promise.all([
      si.system(),
      si.baseboard(),
      si.cpu(),
      si.cpuCurrentspeed(),
      si.mem(),
      si.battery(),
      si.osInfo(),
      si.versions()
    ])
  } catch (err) {
    throw err
  }
}

async function getProcessInfo() {
  try {
    return Promise.all([
      si.currentLoad(),
      si.processes()
    ])
  } catch (err) {
    throw err
  }
}

async function getNetworkInfo() {
  try {
    return Promise.all([
      si.networkInterfaces(),
      si.networkConnections(),
      si.networkStats(),
      si.inetLatency()
    ])
  } catch (err) {
    throw err
  }
}

async function main() {
  try {
    const [ network, process, system ] = await Promise.all([
      getNetworkInfo(),
      getProcessInfo(),
      getSystemInfo()
    ])
    return Object.assign({}, {
      peerInfo: {
        system, network
      }
    })
  } catch (err) {
    throw err
  }
}

module.exports = main
