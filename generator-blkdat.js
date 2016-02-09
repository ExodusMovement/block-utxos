#!/usr/bin/env node
'use strict'

var argv = require('yargs')
  .usage('Usage: $0 -d [dirname] -b [number] -o [filename]')
  .options({
    'd': {
      alias: 'datadir',
      require: true,
      describe: 'path to bitcoin blocks directory',
      type: 'string'
    },
    'b': {
      alias: 'block',
      require: true,
      describe: 'generate utxo for this block height',
      type: 'count'
    },
    'o': {
      alias: 'output',
      require: true,
      describe: 'filename without extension',
      type: 'string'
    }
  })
  .argv

var path = require('path')
var glob = require('glob')
var fs = require('fs')
var MultiStream = require('multistream')
var BlockStream = require('blkdat-stream')

var streams = glob.sync(path.join(argv.datadir, 'blk*.dat')).map(function (filename) {
  return fs.createReadStream(filename)
})

var blockHeight = -1
MultiStream(streams).pipe(new BlockStream())
  .on('data', function (blockBuffer) {
    if (++blockHeight > argv.block) return
  })
  .on('close', function () {
    console.log(blockHeight)
  })
