const Peer = require('./peer')

async function main(sk, cfs, opts) {
  try {
    const p = new Peer(sk, cfs, opts)
    return await p.joinPool(sk, 'work')
  } catch (err) {
    throw err
  }
}

module.exports = main
