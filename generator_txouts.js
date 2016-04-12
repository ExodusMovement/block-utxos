#!/usr/bin/env node
'use strict'

var fs = require('fs')
var RPCClient = require('bitcoin').Client
var bitcoinjs = require('bitcoinjs-lib')
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

/* add block outputs */
function updateOutputs (csvdb, height, block, cb) {
  var outputs = ''
  block.transactions.forEach(function (tx, txIndex) {
    var txId = tx.getId()
    tx.outs.forEach(function (txOutput, outputIndex) {
      var items = [
        height,
        txId,
        outputIndex,
        txOutput.value,
        txOutput.script.toString('hex')
      ]
      outputs += items.join(';') + '\n'
    })
  })

  csvdb.write(outputs, 'ascii', cb)
}

/* handle transactions from blocks [height, lastHeight] */
function handleBlocks (csvdb, height, lastHeight, bar, cb) {
  getBlock(height, function (err, block) {
    if (err) return cb(err)
    updateOutputs(csvdb, height, block, function (err) {
      if (err) return cb(err)
      if (height === lastHeight) return cb(null)
      bar.tick()
      handleBlocks(csvdb, height + 1, lastHeight, bar, cb)
    })
  })
}

/* create progress bar */
var bar = new ProgressBar(':percent (:current/:total), :elapseds elapsed, eta :etas', {
  total: config.lastHeight
})
bar.curr = config.firstHeight

/* run process */
var csvdb = fs.createWriteStream(config.csvdb)
handleBlocks(csvdb, config.firstHeight, config.lastHeight, bar, function (err) {
  if (err) throw err
  csvdb.end()
})
