#!/usr/bin/env node
'use strict'

var fs = require('fs')
var RPCClient = require('bitcoin').Client
var bitcoinjs = require('bitcoinjs-lib')
var memdown = require('memdown')
var leveldown = require('leveldown')
var levelup = require('levelup')
var through2 = require('through2')
var ProgressBar = require('progress')

/* read config and create rpc client */
var config = JSON.parse(fs.readFileSync(process.argv[2]))
var rpc = new RPCClient(config)

/* download block */
function getBlock (height, cb) {
  rpc.getBlockHash(height, function (err, blockHash) {
    if (err) return cb(err)
    rpc.getBlock(blockHash, false, function (err, block) {
      if (err) return cb(err)
      cb(null, bitcoinjs.Block.fromBuffer(new Buffer(block, 'hex')))
    })
  })
}

/* update UTXOs for block */
function updateUTXOs (db, height, block, cb) {
  var batch = db.batch()
  block.transactions.forEach(function (tx, txIndex) {
    var inputs = txIndex > 0 ? tx.ins : tx.ins.slice(1)
    tx.ins.forEach(function (txInput) {
      batch.del(txInput.hash.reverse().toString('hex') + ':' + txInput.index)
    })
    var txId = tx.getId()
    tx.outs.forEach(function (txOutput, outputIndex) {
      batch.put(txId + ':' + outputIndex, {
        value: txOutput.value,
        script: txOutput.script.toString('hex'),
        height: height
      })
    })
  })
  batch.write(cb)
}

/* handle transactions from blocks [height, lastHeight] */
function handleBlocks (db, height, lastHeight, bar, cb) {
  getBlock(height, function (err, block) {
    if (err) return cb(err)
    updateUTXOs(db, height, block, function (err) {
      if (err) return cb(err)
      if (height === lastHeight) return cb(null)
      bar.tick()
      handleBlocks(db, height + 1, lastHeight, bar, cb)
    })
  })
}

/* create json db from leveldb */
function createJSON (db, cb) {
  var isFirst = true

  var writeStream = fs.createWriteStream(config.jsondb, { flags: 'w' })
  writeStream.write('[', function (err) {
    if (err) return cb(err)
    db.createReadStream()
      .pipe(through2({ objectMode: true },
        function (chunk, enc, cb) {
          var dataKey = chunk.key.split(':')
          var data = JSON.stringify({
            txId: dataKey[0],
            outputIndex: dataKey[1],
            value: chunk.value.value,
            script: chunk.value.script,
            height: chunk.value.height
          })

          if (isFirst) {
            isFirst = false
            this.push(data)
          } else {
            this.push(',' + data)
          }

          cb(null)
        },
        function (cb) {
          this.push(']')
          cb(null)
        }
      ))
      .pipe(writeStream)
      .on('error', function (err) {
        cb(err)
      })
      .on('close', function () {
        cb(null)
      })
  })
}

/* open db */
var engine = config.leveldb === ':memory:' ? memdown : leveldown
var db = levelup(config.leveldb, { db: engine, valueEncoding: 'json' })

/* create progress bar */
var bar = new ProgressBar(':percent (:current/:total), :elapseds elapsed, eta :etas', {
  current: config.firstHeight,
  total: config.lastHeight
})

/* run process */
handleBlocks(db, config.firstHeight, config.lastHeight, bar, function (err) {
  if (err) throw err
  createJSON(db, function (err) {
    if (err) throw err
  })
})
